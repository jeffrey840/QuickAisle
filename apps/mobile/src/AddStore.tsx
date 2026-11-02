import { useMemo, useState } from "react";
import {
  Button,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { buildStoreFromDraft } from "@quickaisle/routing";
import { friendlyReason, postIngest, type IngestDraftWire } from "./api";
import { newStoreId, type SavedStore } from "./stores";
import sampleDraftJson from "../../../data/stores/store-002/draft-ingest-v1.json";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sampleMap = require("../../../data/stores/store-002/map.png");

const UPLOAD_LONG_SIDE = 2400;
const STORED_LONG_SIDE = 1400;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

interface EAisle {
  key: string;
  n: string;
  orientation: "vertical" | "horizontal";
  box: [number, number, number, number];
  items: string[];
}

interface DraftState {
  aisles: EAisle[];
  departments: Array<{ name: string; box: number[] }>;
  entrances: Array<{ box: number[]; kind: string }>;
  notes: string[];
  lowConfidence: boolean;
}

function fromWire(json: IngestDraftWire): DraftState {
  return {
    aisles: json.aisles.map((a, i) => ({
      key: `a${i}`,
      n: a.n,
      orientation: a.orientation,
      box: [a.box[0], a.box[1], a.box[2], a.box[3]],
      items: [...a.items],
    })),
    departments: json.departments.map((d) => ({ name: d.name, box: [...d.box] })),
    entrances: json.entrances.map((e) => ({ box: [...e.box], kind: e.kind })),
    notes: [...(json.notes ?? [])],
    lowConfidence: json.lowConfidence,
  };
}

let keyCounter = 0;
const nextKey = (): string => `e${Date.now().toString(36)}-${keyCounter++}`;

async function shrink(
  uri: string,
  w: number,
  h: number,
  longSide: number,
  compress: number,
): Promise<{ uri: string; width: number; height: number; b64: string }> {
  const longest = Math.max(w, h, 1);
  const scale = longest > longSide ? longSide / longest : 1;
  const out = await manipulateAsync(
    uri,
    [{ resize: { width: Math.round(w * scale), height: Math.round(h * scale) } }],
    { compress, format: SaveFormat.JPEG, base64: true },
  );
  if (!out.base64) throw new Error("photo conversion failed");
  return { uri: out.uri, width: out.width, height: out.height, b64: out.base64 };
}

export default function AddStore({
  apiUrl,
  onSaved,
  onCancel,
}: {
  apiUrl: string | undefined;
  onSaved: (s: SavedStore) => void;
  onCancel: () => void;
}) {
  const [storeId] = useState(newStoreId);
  const [phase, setPhase] = useState<"pick" | "reading" | "review">("pick");
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [mapDataUri, setMapDataUri] = useState("");
  const [mapSize, setMapSize] = useState<[number, number]>([1000, 1000]);
  const [name, setName] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [moving, setMoving] = useState<{ fromKey: string; item: string } | null>(null);
  const [addText, setAddText] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newNum, setNewNum] = useState("");
  const [newOri, setNewOri] = useState<"vertical" | "horizontal">("vertical");

  const build = useMemo(() => {
    if (!draft) return null;
    try {
      const r = buildStoreFromDraft(
        {
          aisles: draft.aisles.map((a) => ({
            n: a.n,
            orientation: a.orientation,
            box: [...a.box],
            items: [...a.items],
          })),
          departments: draft.departments,
          entrances: draft.entrances,
        },
        { storeId, imageSize: mapSize },
      );
      return { ok: true as const, warnings: r.warnings, store: r.store };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [draft, mapSize, storeId]);

  const useSample = async () => {
    setError(null);
    setReason(null);
    try {
      const wire = sampleDraftJson as unknown as IngestDraftWire;
      setDraft(fromWire(wire));
      const src = Image.resolveAssetSource(sampleMap) as { uri: string; width: number; height: number };
      try {
        const small = await shrink(src.uri, src.width, src.height, STORED_LONG_SIDE, 0.7);
        setMapDataUri(`data:image/jpeg;base64,${small.b64}`);
        setMapSize([small.width, small.height]);
      } catch {
        // Offline-safe fallback: point at the bundled asset itself.
        setMapDataUri(src.uri);
        setMapSize([src.width || 1662, src.height || 1064]);
      }
      setPhase("review");
    } catch (e) {
      setError("Couldn't load the sample store.");
      setReason(friendlyReason(e));
    }
  };

  const readMapPhoto = async (fromCamera: boolean) => {
    setError(null);
    setReason(null);
    if (!apiUrl) {
      setError("No server configured — try the sample store instead.");
      return;
    }
    try {
      if (Platform.OS !== "web") {
        const perm = fromCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError("Permission denied — try the sample store instead.");
          return;
        }
      }
      const picked = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 1 });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0]!;
      const up = await shrink(asset.uri, asset.width || 2400, asset.height || 1800, UPLOAD_LONG_SIDE, 0.85);
      if ((up.b64.length * 3) / 4 > MAX_UPLOAD_BYTES) {
        setError("That map photo is too big — try a smaller one.");
        return;
      }
      setPhase("reading");
      try {
        const online = await postIngest(apiUrl, { mime: "image/jpeg", b64: up.b64 });
        const small = await shrink(up.uri, up.width, up.height, STORED_LONG_SIDE, 0.7);
        setDraft(fromWire(online));
        setMapDataUri(`data:image/jpeg;base64,${small.b64}`);
        setMapSize([small.width, small.height]);
        setPhase("review");
      } catch (e) {
        setPhase("pick");
        throw e;
      }
    } catch (e) {
      setPhase("pick");
      setError(e instanceof Error ? e.message : String(e));
      setReason(friendlyReason(e));
    }
  };

  const save = () => {
    if (!draft || !build) return;
    if (!name.trim()) {
      setError("Give the store a name.");
      return;
    }
    if (!build.ok) {
      setError(`Can't save yet: ${build.message}`);
      return;
    }
    onSaved({
      id: storeId,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      imageSize: mapSize,
      mapDataUri,
      draft: {
        aisles: draft.aisles.map((a) => ({
          n: a.n,
          orientation: a.orientation,
          box: [...a.box],
          items: [...a.items],
        })),
        departments: draft.departments,
        entrances: draft.entrances,
        notes: draft.notes,
        lowConfidence: draft.lowConfidence,
      },
      store: build.store,
    });
  };

  if (phase === "pick" || phase === "reading") {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Add a store</Text>
        <Text style={styles.hint}>Take a photo of the store map. The AI reads the aisles — you check the draft before saving.</Text>
        <View style={styles.row}>
          {Platform.OS !== "web" ? (
            <Button title="Snap map" onPress={() => void readMapPhoto(true)} disabled={phase === "reading"} />
          ) : null}
          <Button title="Choose map photo" onPress={() => void readMapPhoto(false)} disabled={phase === "reading"} />
        </View>
        <View style={styles.row}>
          <Button title="Try the sample store" onPress={() => void useSample()} disabled={phase === "reading"} />
          <Button title="Cancel" onPress={onCancel} disabled={phase === "reading"} />
        </View>
        {phase === "reading" ? <Text style={styles.hint}>Reading the map… about 20 seconds</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {reason ? <Text style={styles.hint}>{reason}</Text> : null}
      </View>
    );
  }

  if (!draft) return null;
  const [W, H] = mapSize;

  return (
    <ScrollView style={styles.wrap}>
      <Text style={styles.title}>AI draft — check before saving</Text>
      <Text style={styles.label}>Store name (required)</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="My grocery store" />
      <View style={[styles.mapFrame, { aspectRatio: W / H }]}>
        <Image source={{ uri: mapDataUri }} style={styles.mapImage} resizeMode="contain" />
        <Svg viewBox={`0 0 ${W} ${H}`} style={styles.mapSvg}>
          {draft.aisles.map((a) => (
            <Rect
              key={a.key}
              x={(a.box[0] / 1000) * W}
              y={(a.box[1] / 1000) * H}
              width={((a.box[2] - a.box[0]) / 1000) * W}
              height={((a.box[3] - a.box[1]) / 1000) * H}
              fill="none"
              stroke="#dc2626"
              strokeWidth={4}
            />
          ))}
          {draft.aisles.map((a) => (
            <SvgText
              key={"t" + a.key}
              x={(a.box[0] / 1000) * W + 6}
              y={(a.box[1] / 1000) * H + 30}
              fontSize={30}
              fontWeight="bold"
              fill="#dc2626"
            >
              {a.n}
            </SvgText>
          ))}
        </Svg>
      </View>
      {draft.lowConfidence ? (
        <Text style={styles.warn}>Only one AI read succeeded — check every aisle carefully.</Text>
      ) : null}
      {draft.notes.length > 0 ? (
        <View style={styles.row}>
          <Button title={showNotes ? "Hide AI notes" : `Show AI notes (${draft.notes.length})`} onPress={() => setShowNotes((s) => !s)} />
        </View>
      ) : null}
      {showNotes
        ? draft.notes.map((n, i) => (
            <Text key={i} style={styles.hint}>
              • {n}
            </Text>
          ))
        : null}
      {build && build.ok && build.warnings.length > 0 ? (
        <Text style={styles.warn}>Route check: {build.warnings.join(" · ")}</Text>
      ) : null}
      {moving ? (
        <Text style={styles.warn}>
          Moving “{moving.item}” — tap → plus an aisle number, or tap the chip again to cancel.
        </Text>
      ) : null}
      {draft.aisles.map((a) => (
        <View key={a.key} style={styles.aisle}>
          <View style={styles.row}>
            <Text style={styles.label}>Aisle</Text>
            <TextInput
              style={styles.num}
              value={a.n}
              onChangeText={(t) =>
                setDraft((d) =>
                  d ? { ...d, aisles: d.aisles.map((x) => (x.key === a.key ? { ...x, n: t } : x)) } : d,
                )
              }
            />
            <Text style={styles.hint}>{a.orientation}</Text>
            <Button
              title="Delete aisle"
              onPress={() =>
                setDraft((d) => (d ? { ...d, aisles: d.aisles.filter((x) => x.key !== a.key) } : d))
              }
            />
            {moving && moving.fromKey !== a.key ? (
              <Button
                title={`→ ${a.n || "?"}`}
                onPress={() => {
                  const m = moving;
                  setDraft((d) =>
                    d && m
                      ? {
                          ...d,
                          aisles: d.aisles.map((x) => {
                            if (x.key === m.fromKey) return { ...x, items: x.items.filter((i) => i !== m.item) };
                            if (x.key === a.key) return { ...x, items: [...x.items, m.item] };
                            return x;
                          }),
                        }
                      : d,
                  );
                  setMoving(null);
                }}
              />
            ) : null}
          </View>
          <View style={styles.chips}>
            {a.items.map((item, i) => (
              <View key={`${item}-${i}`} style={styles.chipRow}>
                <Text
                  style={styles.chip}
                  onPress={() =>
                    setMoving((m) =>
                      m && m.fromKey === a.key && m.item === item ? null : { fromKey: a.key, item },
                    )
                  }
                >
                  {item} <Text
                    style={styles.x}
                    onPress={() =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              aisles: d.aisles.map((x) =>
                                x.key === a.key
                                  ? { ...x, items: x.items.filter((_, j) => j !== i) }
                                  : x,
                              ),
                            }
                          : d,
                      )
                    }
                  >
                    ✕
                  </Text>
                </Text>
              </View>
            ))}
          </View>
          {addingFor === a.key ? (
            <View style={styles.row}>
              <TextInput
                style={styles.addInput}
                value={addText}
                onChangeText={setAddText}
                placeholder="New item"
                autoFocus
              />
              <Button
                title="Add"
                onPress={() => {
                  const t = addText.trim();
                  if (t) {
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            aisles: d.aisles.map((x) =>
                              x.key === a.key ? { ...x, items: [...x.items, t] } : x,
                            ),
                          }
                        : d,
                    );
                  }
                  setAddText("");
                  setAddingFor(null);
                }}
              />
            </View>
          ) : (
            <Button title="+ item" onPress={() => { setAddingFor(a.key); setAddText(""); }} />
          )}
        </View>
      ))}
      <View style={styles.aisle}>
        <Text style={styles.label}>+ Add aisle</Text>
        <View style={styles.row}>
          <TextInput style={styles.num} value={newNum} onChangeText={setNewNum} placeholder="#" />
          <Button
            title={newOri === "vertical" ? "Vertical ↓" : "Horizontal →"}
            onPress={() => setNewOri((o) => (o === "vertical" ? "horizontal" : "vertical"))}
          />
          <Button
            title="Add aisle"
            onPress={() => {
              const t = newNum.trim();
              if (!t) return;
              // Box = nearest aisle by number, shifted right; the map overlay shows it.
              const numOf = (s: string): number | null => {
                const m = s.match(/^\d+/);
                return m ? Number(m[0]) : null;
              };
              const want = numOf(t) ?? -1;
              let best = draft.aisles[0];
              let bestD = Infinity;
              for (const x of draft.aisles) {
                const nx = numOf(x.n);
                const d = nx === null ? Infinity : Math.abs(nx - want);
                if (d < bestD) {
                  bestD = d;
                  best = x;
                }
              }
              const src = best?.box ?? [100, 100, 200, 400];
              const box: [number, number, number, number] = [
                Math.min(src[0] + 20, 940),
                src[1],
                Math.min(src[2] + 20, 980),
                src[3],
              ];
              setDraft((d) =>
                d ? { ...d, aisles: [...d.aisles, { key: nextKey(), n: t, orientation: newOri, box, items: [] }] } : d,
              );
              setNewNum("");
            }}
          />
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Button title="Save store" onPress={save} />
        <Button title="Cancel" onPress={onCancel} />
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 8 },
  label: { fontWeight: "bold", fontSize: 14 },
  hint: { color: "#666", marginTop: 4, fontSize: 12 },
  error: { color: "#b91c1c", marginVertical: 8 },
  warn: { color: "#b45309", marginVertical: 6 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 10, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  mapFrame: { width: "100%", borderWidth: 1, borderColor: "#ddd", borderRadius: 8, overflow: "hidden", backgroundColor: "#f8fafc", marginBottom: 8 },
  mapImage: { position: "absolute", width: "100%", height: "100%" },
  mapSvg: { position: "absolute", width: "100%", height: "100%" },
  aisle: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, marginBottom: 8 },
  num: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 6, minWidth: 56, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 6 },
  chipRow: { flexDirection: "row" },
  chip: { backgroundColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13 },
  x: { color: "#b91c1c", fontWeight: "bold" },
  addInput: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 6, flex: 1, minWidth: 120 },
});
