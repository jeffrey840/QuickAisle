import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Image,
  Platform,
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
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { StoreDoc, type StoreDoc as StoreDocType } from "@quickaisle/schema";
import { doorLabel, planRoute, type RouteResult } from "@quickaisle/routing";
import { dedupeIds, departmentFallback, normalize, resolveLocal } from "@quickaisle/matching";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deviceAliases, saveLearnedAliases } from "./src/aliasStore";
import { friendlyReason, postReadList, postResolve } from "./src/api";
import AddStore from "./src/AddStore";
import VoiceButton from "./src/VoiceButton";
import { createStoreRepo, HEB_ID, type SavedStore } from "./src/stores";
import { cardForTerm, mergePick, type ClarifyCard } from "./src/clarify";
import {
  current as shopCurrent,
  isDone as shopDone,
  markGot,
  markSkipped,
  startShop,
  summarize as shopSummary,
  type ShopState,
} from "./src/shop";
import storeJson from "../../data/stores/heb-001/store.json";

const hebStore: StoreDocType = StoreDoc.parse(storeJson);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hebMapImage = require("../../data/stores/heb-001/map.png");
const repo = createStoreRepo(AsyncStorage);
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const MAX_ONLINE_TERMS = 30;

const TEST_A = "prescriptions, eggs, apples, cereal, cheese, chicken, razors";
const TEST_B = "cookies, pickles, water, sushi, frozen food";

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ZoomableMap({
  route,
  highlight,
  mapSource,
  mapW,
  mapH,
}: {
  route: RouteResult;
  highlight?: { current: number | null; dimmed: boolean[] };
  mapSource: { uri: string } | number;
  mapW: number;
  mapH: number;
}) {
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
        <Animated.View style={[styles.mapBox, style, { aspectRatio: mapW / mapH }]}>
          <Image source={mapSource} style={styles.mapImage} resizeMode="contain" />
          <Svg viewBox={`0 0 ${mapW} ${mapH}`} style={styles.mapSvg}>
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
                r={highlight && highlight.current === i ? 26 : 16}
                fill={highlight && highlight.current === i ? "#dc2626" : "#2563eb"}
                stroke="#fff"
                strokeWidth={4}
                opacity={highlight && highlight.dimmed[i] ? 0.3 : 1}
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
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [photoReason, setPhotoReason] = useState<string | null>(null);
  const [cards, setCards] = useState<ClarifyCard[]>([]);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [saved, setSaved] = useState<SavedStore[]>([]);
  const [selectedId, setSelectedId] = useState<string>(HEB_ID);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void (async () => {
      const [list, sel] = await Promise.all([repo.list(), repo.selected()]);
      setSaved(list);
      setSelectedId(sel);
    })();
  }, []);

  const active = useMemo(() => {
    const s = saved.find((x) => x.id === selectedId);
    if (s) {
      return { id: s.id, name: s.name, doc: s.store, map: { uri: s.mapDataUri } as { uri: string } | number };
    }
    return { id: HEB_ID, name: "H-E-B", doc: hebStore, map: hebMapImage as { uri: string } | number };
  }, [saved, selectedId]);
  const productIds = useMemo(() => new Set(active.doc.products.map((p) => p.id)), [active]);

  const clearPlan = () => {
    setRoute(null);
    setUnmatched([]);
    setCards([]);
    setMatchedIds([]);
    setShop(null);
    setError(null);
    setNotes([]);
  };

  const pickStore = (id: string) => {
    clearPlan();
    setText("");
    setSelectedId(id);
    void repo.select(id);
  };

  const deleteActiveStore = () => {
    const id = active.id;
    void (async () => {
      await repo.remove(id);
      setSaved(await repo.list());
      pickStore(HEB_ID);
    })();
  };

  const confirmDeleteStore = () => {
    const msg = `Delete ${active.name}? This can't be undone.`;
    if (Platform.OS === "web") {
      const w = globalThis as { confirm?: (m: string) => boolean };
      if (w.confirm?.(msg)) deleteActiveStore();
    } else {
      Alert.alert("Delete store", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: deleteActiveStore },
      ]);
    }
  };

  const plan = async () => {
    setError(null);
    setPhotoReason(null);
    setCards([]);
    setShop(null);
    try {
      const terms = parseList(text);
      if (terms.length === 0) {
        setError("Type at least one item.");
        return;
      }
      // Local first (exact → learned alias → fuzzy). Alias-store failure
      // degrades to no learned aliases, never to an error.
      const local = await resolveLocal(terms, active.doc.products, {
        storeId: active.id,
        aliases: deviceAliases,
      }).catch(() => resolveLocal(terms, active.doc.products));
      const matched = local.matched.map((m) => ({ term: m.term, productId: m.productId }));
      let noMatch = local.needAi.map((n) => n.term);
      // Online top-up for the leftovers. Any failure (no server, timeout,
      // bad response) keeps the local-only result — offline behavior is
      // identical to before this change.
      const clarifies = new Map<string, { question: string; options: string[] }>();
      if (noMatch.length > 0 && API_URL) {
        setResolving(true);
        try {
          const catalog =
            active.id === HEB_ID
              ? undefined
              : active.doc.products.map((p) => ({ id: p.id, name: p.name }));
          const online = await postResolve(API_URL, active.id, noMatch.slice(0, MAX_ONLINE_TERMS), 60_000, catalog);
          const fixed = new Set<string>();
          for (const a of online.answers) {
            if (a.needsClarification) {
              if (!clarifies.has(a.input)) {
                clarifies.set(a.input, { question: a.question, options: a.options });
              }
              continue;
            }
            const top = a.matches[0];
            if (top && productIds.has(top.productId)) {
              matched.push({ term: a.input, productId: top.productId });
              fixed.add(a.input);
            }
          }
          noMatch = noMatch.filter((t) => !fixed.has(t));
          await saveLearnedAliases(active.id, online.learnedAliases).catch(() => {});
        } catch {
          // keep local-only result
        } finally {
          setResolving(false);
        }
      }
      // Department fallback for the still-unmatched: common staples route
      // to their department. Pure and offline-safe — no network here.
      // Hits count as matched and get no card.
      if (noMatch.length > 0) {
        const still: string[] = [];
        for (const t of noMatch) {
          const hit = departmentFallback(t, active.doc.products);
          if (hit) matched.push({ term: t, productId: hit.id });
          else still.push(t);
        }
        noMatch = still;
      }
      // One card per still-unmatched term that has something to ask, in
      // list order. Carded terms leave "No match" until skipped.
      const newCards: ClarifyCard[] = [];
      for (const n of local.needAi) {
        if (!noMatch.includes(n.term)) continue;
        const card = cardForTerm(n.term, clarifies.get(n.term), n.suggestions, active.doc.products);
        if (card) newCards.push(card);
      }
      const carded = new Set(newCards.map((c) => c.term));
      setCards(newCards);
      setUnmatched(noMatch.filter((t) => !carded.has(t)));
      if (matched.length === 0) {
        setError("Nothing matched. Try Test A or Test B.");
        setRoute(null);
        return;
      }
      const ids = dedupeIds(matched.map((m) => m.productId));
      setMatchedIds(ids);
      const r = planRoute(active.doc, ids, { prescriptionReady: rxReady });
      setRoute(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const answerCard = async (card: ClarifyCard, productId: string | null) => {
    setCards((cs) => cs.slice(1));
    setShop(null);
    if (!productId) {
      setUnmatched((u) => [...u, card.term]);
      return;
    }
    try {
      if (card.kind === "suggest") {
        await deviceAliases
          .save(active.id, normalize(card.term), productId, card.similarity ?? 0.85)
          .catch(() => {});
      }
      const ids = mergePick(matchedIds, productId);
      setMatchedIds(ids);
      setRoute(planRoute(active.doc, ids, { prescriptionReady: rxReady }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startShopping = () => {
    if (!route) return;
    setShop(
      startShop(
        route.stops.map((s) => ({
          label: s.aisleLabel ? `${s.aisleLabel} — ${s.name}` : s.name,
          name: s.name,
        })),
      ),
    );
  };

  const card = cards[0] ?? null;
  const sh = shop ? shopCurrent(shop) : null;
  const shopFinished = shop ? shopDone(shop) : false;
  const shopSum = shop && shopFinished ? shopSummary(shop) : null;
  const mapHighlight = shop
    ? {
        current: sh ? sh.position - 1 : null,
        dimmed: shop.got.map((g, i) => g || shop.skipped[i]!),
      }
    : undefined;

  const readPhoto = async (fromCamera: boolean) => {
    setError(null);
    setPhotoReason(null);
    if (fromCamera && Platform.OS === "web") {
      setError("Camera isn't available in the browser — choose a photo instead.");
      return;
    }
    if (!API_URL) {
      setError("Couldn't read the photo — type your list instead.");
      return;
    }
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError("Camera permission denied — type your list instead.");
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError("Photo library permission denied — type your list instead.");
          return;
        }
      }
      const picked = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 1 });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0]!;
      const longest = Math.max(asset.width, asset.height);
      const scale = longest > 1280 ? 1280 / longest : 1;
      const small = await manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      );
      if (!small.base64) throw new Error("photo conversion failed");
      setReading(true);
      try {
        const online = await postReadList(API_URL, active.id, {
          mime: "image/jpeg",
          b64: small.base64,
        });
        if (online.items.length === 0) {
          setError("No items found in that photo — try again or type your list.");
          return;
        }
        const lines = online.items.map((i) => {
          const q = (i.quantity ?? "").trim();
          return q && !i.text.toLowerCase().includes(q.toLowerCase())
            ? `${i.text} ${q}`
            : i.text;
        });
        setText(lines.join("\n"));
        setNotes(online.notes);
        setUnmatched([]);
        setRoute(null);
      } finally {
        setReading(false);
      }
    } catch (e) {
      // Text box untouched on any failure.
      setReading(false);
      setError("Couldn't read the photo — type your list instead.");
      setPhotoReason(friendlyReason(e));
    }
  };

  if (adding) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <AddStore
          apiUrl={API_URL}
          onCancel={() => setAdding(false)}
          onSaved={(s) => {
            void (async () => {
              await repo.save(s);
              setSaved(await repo.list());
              pickStore(s.id);
              setAdding(false);
            })();
          }}
        />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.title}>QuickAisle — {active.name}</Text>
        <View style={styles.row}>
          <Button
            key={HEB_ID}
            title={active.id === HEB_ID ? "● H-E-B" : "H-E-B"}
            onPress={() => pickStore(HEB_ID)}
          />
          {saved.map((s) => (
            <Button
              key={s.id}
              title={active.id === s.id ? `● ${s.name}` : s.name}
              onPress={() => pickStore(s.id)}
            />
          ))}
          <Button title="+ Add a store" onPress={() => setAdding(true)} />
        </View>
        <View style={styles.row}>
          {Platform.OS !== "web" ? (
            <Button title="Snap list" onPress={() => void readPhoto(true)} disabled={reading} />
          ) : null}
          <Button title="Choose photo" onPress={() => void readPhoto(false)} disabled={reading} />
        </View>
        <TextInput
          style={styles.input}
          multiline
          value={text}
          onChangeText={(t) => { setText(t); setError(null); setPhotoReason(null); }}
          placeholder="milk, eggs, cereal…"
          placeholderTextColor="#6b7280"
        />
        {Platform.OS !== "web" ? (
          <View style={styles.row}>
            <VoiceButton
              apiUrl={API_URL}
              onTranscript={(t) => {
                setText((prev) => (prev.trim() ? `${prev}\n${t}` : t));
                setError(null);
                setPhotoReason(null);
              }}
            />
          </View>
        ) : null}
        {notes.length > 0 ? (
          <Text style={styles.hint}>Note: {notes.join(" · ")}</Text>
        ) : null}
        <View style={styles.row}>
          {active.id === HEB_ID ? (
            <>
              <Button title="Test A" onPress={() => { setText(TEST_A); setNotes([]); setError(null); setPhotoReason(null); }} />
              <Button title="Test B" onPress={() => { setText(TEST_B); setNotes([]); setError(null); setPhotoReason(null); }} />
            </>
          ) : null}
          <View style={styles.rxRow}>
            <Text style={styles.rxLabel}>Rx ready</Text>
            <Switch value={rxReady} onValueChange={setRxReady} />
          </View>
          <Button title="Plan route" onPress={plan} disabled={resolving || reading} />
        </View>
        {resolving ? <Text style={styles.hint}>Resolving with AI…</Text> : null}
        {reading ? <Text style={styles.hint}>Reading list…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {photoReason ? <Text style={styles.hint}>{photoReason}</Text> : null}
        {unmatched.length > 0 ? (
          <Text style={styles.unmatched}>No match: {unmatched.join(", ")}</Text>
        ) : null}
        {card ? (
          <View style={styles.card}>
            <Text style={styles.savings}>Quick question: {card.term}</Text>
            <Text style={styles.stop}>{card.question}</Text>
            <View style={styles.row}>
              {card.kind === "suggest" ? (
                <>
                  <Button title="Yes" onPress={() => void answerCard(card, card.options[0]!.productId)} />
                  <Button title="No" onPress={() => void answerCard(card, null)} />
                </>
              ) : (
                <>
                  {card.options.map((o) => (
                    <Button key={o.productId} title={o.name} onPress={() => void answerCard(card, o.productId)} />
                  ))}
                  <Button title="Skip" onPress={() => void answerCard(card, null)} />
                </>
              )}
            </View>
            {cards.length > 1 ? (
              <Text style={styles.hint}>{cards.length - 1} more question{cards.length > 2 ? "s" : ""}</Text>
            ) : null}
          </View>
        ) : null}
        {route ? (
          <View style={styles.result}>
            {sh ? (
              <View>
                <Text style={styles.shopLabel}>{sh.stop.label}</Text>
                <Text style={styles.hint}>{sh.position} of {sh.total}</Text>
                <View style={styles.row}>
                  <Button title="Got it" onPress={() => setShop((s) => (s ? markGot(s) : s))} />
                  <Button title="Skip for now" onPress={() => setShop((s) => (s ? markSkipped(s) : s))} />
                </View>
              </View>
            ) : shopSum ? (
              <View>
                <Text style={styles.savings}>
                  Done: {shopSum.got} got, {shopSum.skipped} skipped
                  {shopSum.skippedNames.length > 0 ? ` (${shopSum.skippedNames.join(", ")})` : ""}
                </Text>
                <Button title="Back to list" onPress={() => setShop(null)} />
              </View>
            ) : (
              <View>
                <Text style={styles.savings}>
                  {route.savingsPct}% shorter than typed order ·{" "}
                  in {doorLabel(active.doc, route.entranceId)} / out {doorLabel(active.doc, route.exitId)}
                </Text>
                <ScrollView style={styles.stops} nestedScrollEnabled>
                  {route.stops.map((s, i) => (
                    <Text key={s.locationId + i} style={styles.stop}>
                      {i + 1}. {s.instruction}
                    </Text>
                  ))}
                </ScrollView>
                <Button title="Start shopping" onPress={startShopping} />
              </View>
            )}
            <ZoomableMap
              route={route}
              highlight={mapHighlight}
              mapSource={active.map}
              mapW={active.doc.imageSize[0]}
              mapH={active.doc.imageSize[1]}
            />
            <Text style={styles.hint}>Pinch to zoom · drag to pan · double-tap to reset</Text>
          </View>
        ) : null}
        {active.id !== HEB_ID ? (
          <View style={styles.row}>
            <Button title="Delete this store" onPress={confirmDeleteStore} />
          </View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Explicit light background + dark text throughout: Android dark mode
  // (edge-to-edge, ignores userInterfaceStyle) must not restyle us.
  root: { flex: 1, backgroundColor: "#ffffff" },
  container: { flex: 1, padding: 16, paddingTop: 48, paddingBottom: 48, backgroundColor: "#ffffff" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8, color: "#111827" },
  hint: { color: "#666", marginTop: 4, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 8,
    padding: 10,
    height: 76,
    textAlignVertical: "top",
    marginBottom: 8,
    color: "#111827",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  rxRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  rxLabel: { color: "#111827" },
  error: { color: "#b91c1c", marginBottom: 8 },
  unmatched: { color: "#b45309", marginBottom: 8 },
  result: { flex: 1, marginTop: 4 },
  savings: { fontWeight: "bold", marginBottom: 4, color: "#111827" },
  card: {
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#eff6ff",
  },
  shopLabel: { fontSize: 24, fontWeight: "bold", marginBottom: 2, color: "#111827" },
  stops: { maxHeight: 110, marginBottom: 4 },
  stop: { marginBottom: 2, color: "#111827" },
  mapFrame: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
  },
  mapBox: { width: "100%" },
  mapImage: { position: "absolute", width: "100%", height: "100%" },
  mapSvg: { position: "absolute", width: "100%", height: "100%" },
});
