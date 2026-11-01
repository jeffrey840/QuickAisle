import { useMemo, useState } from "react";
import {
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Polyline, Text as SvgText } from "react-native-svg";
import { StoreDoc, type StoreDoc as StoreDocType } from "@quickaisle/schema";
import { planRoute, type RouteResult } from "@quickaisle/routing";
import { resolveLocal } from "@quickaisle/matching";
import { deviceAliases, saveLearnedAliases } from "./src/aliasStore";
import { postResolve } from "./src/api";
import storeJson from "../../data/stores/heb-001/store.json";

const store: StoreDocType = StoreDoc.parse(storeJson);
const STORE_ID = store.storeId;
const PRODUCT_IDS = new Set(store.products.map((p) => p.id));
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const MAX_ONLINE_TERMS = 30;
const MAP_W = store.imageSize[0];
const MAP_H = store.imageSize[1];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapImage = require("../../data/stores/heb-001/map.png");

const TEST_A = "prescriptions, eggs, apples, cereal, cheese, chicken, razors";
const TEST_B = "cookies, pickles, water, sushi, frozen food";

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ZoomableMap({ route }: { route: RouteResult }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(5, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
    });
  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const points = useMemo(
    () => route.polyline.map(([x, y]) => `${x},${y}`).join(" "),
    [route],
  );

  return (
    <View style={styles.mapFrame}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.mapBox, style]}>
          <Image source={mapImage} style={styles.mapImage} resizeMode="contain" />
          <Svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={styles.mapSvg}>
            <Polyline
              points={points}
              fill="none"
              stroke="#2563eb"
              strokeWidth={9}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
            {route.stops.map((s, i) => (
              <SvgText
                key={s.locationId + i}
                x={s.xy[0]}
                y={s.xy[1] - 30}
                fontSize={26}
                fontWeight="bold"
                fill="#1d4ed8"
                textAnchor="middle"
              >
                {`${i + 1}`}
              </SvgText>
            ))}
            {route.stops.map((s, i) => (
              <Circle
                key={"c" + s.locationId + i}
                cx={s.xy[0]}
                cy={s.xy[1]}
                r={16}
                fill="#2563eb"
                stroke="#fff"
                strokeWidth={4}
              />
            ))}
          </Svg>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function App() {
  const [text, setText] = useState(TEST_A);
  const [rxReady, setRxReady] = useState(true);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const plan = async () => {
    setError(null);
    try {
      const terms = parseList(text);
      if (terms.length === 0) {
        setError("Type at least one item.");
        return;
      }
      // Local first (exact → learned alias → fuzzy). Alias-store failure
      // degrades to no learned aliases, never to an error.
      const local = await resolveLocal(terms, store.products, {
        storeId: STORE_ID,
        aliases: deviceAliases,
      }).catch(() => resolveLocal(terms, store.products));
      const matched = local.matched.map((m) => ({ term: m.term, productId: m.productId }));
      let noMatch = local.needAi.map((n) => n.term);
      // Online top-up for the leftovers. Any failure (no server, timeout,
      // bad response) keeps the local-only result — offline behavior is
      // identical to before this change.
      if (noMatch.length > 0 && API_URL) {
        setResolving(true);
        try {
          const online = await postResolve(API_URL, STORE_ID, noMatch.slice(0, MAX_ONLINE_TERMS));
          const fixed = new Set<string>();
          for (const a of online.answers) {
            const top = !a.needsClarification ? a.matches[0] : undefined;
            if (top && PRODUCT_IDS.has(top.productId)) {
              matched.push({ term: a.input, productId: top.productId });
              fixed.add(a.input);
            }
          }
          noMatch = noMatch.filter((t) => !fixed.has(t));
          await saveLearnedAliases(STORE_ID, online.learnedAliases).catch(() => {});
        } catch {
          // keep local-only result
        } finally {
          setResolving(false);
        }
      }
      setUnmatched(noMatch);
      if (matched.length === 0) {
        setError("Nothing matched. Try Test A or Test B.");
        setRoute(null);
        return;
      }
      const r = planRoute(
        store,
        matched.map((m) => m.productId),
        { prescriptionReady: rxReady },
      );
      setRoute(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.title}>QuickAisle — H-E-B demo</Text>
        <TextInput
          style={styles.input}
          multiline
          value={text}
          onChangeText={setText}
          placeholder="milk, eggs, cereal…"
        />
        <View style={styles.row}>
          <Button title="Test A" onPress={() => setText(TEST_A)} />
          <Button title="Test B" onPress={() => setText(TEST_B)} />
          <View style={styles.rxRow}>
            <Text>Rx ready</Text>
            <Switch value={rxReady} onValueChange={setRxReady} />
          </View>
          <Button title="Plan route" onPress={plan} disabled={resolving} />
        </View>
        {resolving ? <Text style={styles.hint}>Resolving with AI…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {unmatched.length > 0 ? (
          <Text style={styles.unmatched}>No match: {unmatched.join(", ")}</Text>
        ) : null}
        {route ? (
          <View style={styles.result}>
            <Text style={styles.savings}>
              {route.savingsPct}% shorter than typed order ·{" "}
              in {route.entranceId} / out {route.exitId}
            </Text>
            <ScrollView style={styles.stops} nestedScrollEnabled>
              {route.stops.map((s, i) => (
                <Text key={s.locationId + i} style={styles.stop}>
                  {i + 1}. {s.instruction}
                </Text>
              ))}
            </ScrollView>
            <ZoomableMap route={route} />
            <Text style={styles.hint}>Pinch to zoom · drag to pan · double-tap to reset</Text>
          </View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, padding: 16, paddingTop: 48 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  hint: { color: "#666", marginTop: 4, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 8,
    padding: 10,
    height: 76,
    textAlignVertical: "top",
    marginBottom: 8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  rxRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  error: { color: "#b91c1c", marginBottom: 8 },
  unmatched: { color: "#b45309", marginBottom: 8 },
  result: { flex: 1, marginTop: 4 },
  savings: { fontWeight: "bold", marginBottom: 4 },
  stops: { maxHeight: 110, marginBottom: 4 },
  stop: { marginBottom: 2 },
  mapFrame: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
  },
  mapBox: { width: "100%", aspectRatio: MAP_W / MAP_H },
  mapImage: { position: "absolute", width: "100%", height: "100%" },
  mapSvg: { position: "absolute", width: "100%", height: "100%" },
});
