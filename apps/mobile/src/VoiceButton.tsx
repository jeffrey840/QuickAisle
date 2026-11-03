import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  requestRecordingPermissionsAsync,
  useAudioStream,
  type AudioStreamBuffer,
  type AudioStreamOptions,
} from "expo-audio";
import { postVoiceList } from "./api";
import {
  MAX_VOICE_SECONDS,
  MIN_VOICE_SECONDS,
  VOICE_NATIVE_RATES,
  bytesToBase64,
  concatInt16,
  downmixToMono,
  encodeWav,
  resampleInt16,
} from "./wav";

/**
 * Hold-to-talk: press in to record mic PCM, release to transcribe into the
 * list text box via POST /voice-list. Native only (hidden on web by the
 * parent). Never auto-submits — the user still taps Plan route.
 */
export default function VoiceButton({
  apiUrl,
  onTranscript,
}: {
  apiUrl: string | undefined;
  onTranscript: (text: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "listening" | "transcribing">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const rateRef = useRef(16000);
  const channelsRef = useRef(1);
  const streamRef = useRef<ReturnType<typeof useAudioStream>["stream"] | null>(null);
  /** a take is in progress (recording or transcribing) */
  const busyRef = useRef(false);
  /** still recording (guards the press-out/auto-stop race) */
  const recordingRef = useRef(false);
  const propsRef = useRef({ apiUrl, onTranscript });
  propsRef.current = { apiUrl, onTranscript };

  const finish = useCallback(async (): Promise<void> => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    try {
      streamRef.current?.stop();
    } catch {
      // already stopped — keep finalizing what we captured
    }
    try {
      const rate = rateRef.current;
      let pcm = downmixToMono(concatInt16(chunksRef.current), channelsRef.current);
      let outRate = rate;
      if (!VOICE_NATIVE_RATES.includes(rate as 16000 | 24000)) {
        pcm = resampleInt16(pcm, rate, 16000);
        outRate = 16000;
      }
      const seconds = pcm.length / outRate;
      if (seconds < MIN_VOICE_SECONDS) {
        setPhase("idle");
        setMessage("Too short — hold the button and speak.");
        return;
      }
      pcm = pcm.slice(0, Math.floor(MAX_VOICE_SECONDS * outRate));
      const { apiUrl: url, onTranscript: done } = propsRef.current;
      if (!url) {
        setPhase("idle");
        setMessage("No server configured — type your list instead.");
        return;
      }
      setPhase("transcribing");
      const b64 = bytesToBase64(encodeWav(pcm, outRate));
      const { transcript } = await postVoiceList(url, { mime: "audio/wav", b64 });
      setPhase("idle");
      setMessage(null);
      done(transcript);
    } catch (e) {
      setPhase("idle");
      setMessage(e instanceof Error ? e.message : "Couldn't transcribe — try again.");
    } finally {
      busyRef.current = false;
    }
  }, []);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const onBuffer = useCallback((buf: AudioStreamBuffer): void => {
    if (!recordingRef.current) return;
    if (chunksRef.current.length === 0) {
      rateRef.current = buf.sampleRate;
      channelsRef.current = buf.channels;
    }
    const even = buf.data.byteLength & ~1;
    if (even < 2) return;
    // Copy: native may reuse buf.data after this callback returns.
    chunksRef.current.push(new Int16Array(buf.data.slice(0, even)));
    // Auto-stop at the cap; finish() truncates any overshoot.
    const frames = chunksRef.current.reduce((s, c) => s + c.length, 0);
    const samples = Math.floor(frames / Math.max(1, channelsRef.current));
    if (samples / rateRef.current >= MAX_VOICE_SECONDS) {
      void finishRef.current();
    }
  }, []);

  const options = useMemo<AudioStreamOptions>(
    () => ({ sampleRate: 16000, channels: 1, encoding: "int16", onBuffer }),
    [onBuffer],
  );
  const { stream } = useAudioStream(options);
  streamRef.current = stream;

  useEffect(
    () => () => {
      try {
        streamRef.current?.stop();
      } catch {
        // unmounting — nothing to finalize
      }
    },
    [],
  );

  const pressIn = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    recordingRef.current = false;
    setMessage(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMessage("Microphone permission denied — type your list instead.");
        busyRef.current = false;
        return;
      }
    } catch {
      setMessage("Couldn't access the microphone — type your list instead.");
      busyRef.current = false;
      return;
    }
    chunksRef.current = [];
    rateRef.current = 16000;
    channelsRef.current = 1;
    recordingRef.current = true;
    setPhase("listening");
    try {
      await streamRef.current?.start();
    } catch {
      recordingRef.current = false;
      busyRef.current = false;
      setPhase("idle");
      setMessage("Couldn't start recording — try again.");
    }
  };

  return (
    <View>
      <Pressable
        onPressIn={() => void pressIn()}
        onPressOut={() => void finishRef.current()}
        accessibilityLabel="Hold to talk"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Hold to talk</Text>
      </Pressable>
      {phase === "listening" ? <Text style={styles.status}>Listening…</Text> : null}
      {phase === "transcribing" ? <Text style={styles.status}>Transcribing…</Text> : null}
      {message ? <Text style={styles.status}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  pressed: { backgroundColor: "#1d4ed8" },
  buttonText: { color: "#ffffff", fontWeight: "bold", fontSize: 14 },
  status: { color: "#111827", marginTop: 4, fontSize: 12 },
});
