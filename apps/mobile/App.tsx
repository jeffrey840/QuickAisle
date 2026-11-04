import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";
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
import Btn from "./src/Btn";
import { Divider, Header, Row, Stamp } from "./src/Receipt";
import { areaColor, areaLabel } from "./src/lineColors";
import { splitSpoken } from "./src/spoken";
import VoiceButton from "./src/VoiceButton";
import { colors, mono } from "./src/theme";
import { createStoreRepo, HEB_ID, type SavedStore } from "./src/stores";
import { cardForTerm, mergePick, type ClarifyCard } from "./src/clarify";
import { addCardTerm, buildTermsById, termsSuffix, type TermsById } from "./src/stopTerms";
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
// Verbatim copy of api.ts's 429 text (that const isn't exported, and api.ts
// is frozen) — used only to pick the red-box style. Same text either way.
const DEMO_LIMIT_TEXT = "Demo limit reached — try again later or use the sample store";

/** A stop's list words without the " — " prefix termsSuffix adds. Display only. */
function stopWords(productId: string, name: string, termsById: TermsById): string {
  return termsSuffix(productId, name, termsById).replace(/^ — /, "");
}

/** Display state of one transit-line row. Reads shop state, changes nothing. */
function stopRowState(
  shop: ShopState | null,
  i: number,
): "got" | "skipped" | "current" | "upcoming" {
  if (shop?.got[i]) return "got";
  if (shop?.skipped[i]) return "skipped";
  if (shop && i === shop.index) return "current";
  return "upcoming";
}

/** Distinct legend entries (label + color) in order of first appearance. */
function legendEntries(stops: Array<{ name: string; aisleLabel?: string }>): Array<{
  label: string;
  color: string;
}> {
  const seen = new Map<string, string>();
  for (const s of stops) {
    const display = s.aisleLabel ? `${s.aisleLabel} — ${s.name}` : s.name;
    const label = areaLabel(display);
    if (!seen.has(label)) seen.set(label, areaColor(display));
  }
  return [...seen].map(([label, color]) => ({ label, color }));
}

/** One transit-line stop row. Presentational; all data comes from props. */
function ShopLineRow({
  stop,
  state,
  words,
}: {
  stop: { name: string; aisleLabel?: string };
  state: "got" | "skipped" | "current" | "upcoming";
  words: string;
}) {
  const label =
    stop.aisleLabel && stop.aisleLabel.toLowerCase() !== stop.name.toLowerCase()
      ? `${stop.aisleLabel} — ${stop.name}`
      : stop.name;
  const color = areaColor(label);
  const where = stop.aisleLabel && /\baisles?\b/i.test(stop.aisleLabel) ? "aisle" : "area";
  if (state === "current") {
    return (
      <View style={[styles.lineRow, styles.currentBlock]}>
        <View style={[styles.dot, styles.currentDot]} />
        <View>
          <Text style={styles.currentLabel}>
            {label}
            <Text style={styles.lineSuffix}> · {where}</Text>
          </Text>
          {words ? <Text style={styles.currentWords}>{words}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.lineRow}>
      <View
        style={
          state === "skipped"
            ? [styles.dot, styles.skippedDot, { borderColor: color }]
            : [styles.dot, { backgroundColor: color }]
        }
      />
      {state === "got" ? (
        <Text style={styles.doneLabel}>
          {label}
          <Text style={styles.lineSuffix}> · {where}</Text>
          <Text style={{ color: color }}> ✓</Text>
        </Text>
      ) : (
        <Text style={styles.lineLabel}>
          {label}
          <Text style={styles.lineSuffix}> · {where}</Text>
          {state === "skipped" ? <Text style={{ color: color }}> · skipped, come back</Text> : null}
        </Text>
      )}
    </View>
  );
}

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
  const [termsById, setTermsById] = useState<TermsById>({});
  const [shop, setShop] = useState<ShopState | null>(null);
  const [saved, setSaved] = useState<SavedStore[]>([]);
  const [selectedId, setSelectedId] = useState<string>(HEB_ID);
  const [adding, setAdding] = useState(false);
  const [showStores, setShowStores] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);

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
    setTermsById({});
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
      setTermsById(buildTermsById(matched));
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
      setTermsById((t) => addCardTerm(t, productId, card.term));
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
          label:
            (s.aisleLabel ? `${s.aisleLabel} — ${s.name}` : s.name) +
            termsSuffix(s.productId, s.name, termsById),
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
              setJustSaved(s.name);
              setTimeout(() => setJustSaved(null), 1500);
            })();
          }}
        />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <GHScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Header subtitle={`STORE: ${active.name} ▾`} onPressSubtitle={() => setShowStores((s) => !s)} />
        {justSaved ? (
          <View style={styles.savedWrap}>
            <Stamp text="STORE SAVED" />
            <Text style={styles.savedNote}>{justSaved} · saved on this phone only</Text>
          </View>
        ) : null}
        {showStores ? (
          <View style={styles.storeBlock}>
            <Text style={styles.sectionLabel}>YOUR STORES</Text>
            <Btn
              key={HEB_ID}
              title={active.id === HEB_ID ? "● H-E-B … IN USE" : "H-E-B"}
              onPress={() => { pickStore(HEB_ID); setShowStores(false); }}
              variant={active.id === HEB_ID ? "selected" : "outline"}
              full
            />
            {saved.map((s) => (
              <Btn
                key={s.id}
                title={active.id === s.id ? `● ${s.name} … IN USE` : s.name}
                onPress={() => { pickStore(s.id); setShowStores(false); }}
                variant={active.id === s.id ? "selected" : "outline"}
                full
              />
            ))}
            <Btn title="+ Add a store" onPress={() => setAdding(true)} variant="primary" full />
          </View>
        ) : null}
        {/* List entry hides while shopping so the panel + map fit. */}
        {sh ? null : (<>
        <Text style={styles.sectionLabel}>YOUR LIST</Text>
        <TextInput
          style={styles.input}
          multiline
          value={text}
          onChangeText={(t) => { setText(t); setError(null); setPhotoReason(null); }}
          placeholder="milk, eggs, cereal…"
          placeholderTextColor="#6b7280"
        />
        <View style={styles.row}>
          {Platform.OS !== "web" ? (
            <Btn title="Snap list" onPress={() => void readPhoto(true)} disabled={reading} variant="outline" />
          ) : null}
          <Btn title="Choose photo" onPress={() => void readPhoto(false)} disabled={reading} variant="outline" />
        </View>
        {Platform.OS !== "web" ? (
          <View style={styles.row}>
            <VoiceButton
              apiUrl={API_URL}
              onTranscript={(t) => {
                const phrases: string[] = [];
                for (const p of active.doc.products) {
                  phrases.push(p.name, ...p.aliases);
                }
                const line = splitSpoken(t, phrases).join(", ");
                setText((prev) => (prev.trim() ? `${prev}\n${line}` : line));
                setError(null);
                setPhotoReason(null);
              }}
            />
          </View>
        ) : null}
        {notes.length > 0 ? (
          <Text style={styles.hint}>Note: {notes.join(" · ")}</Text>
        ) : null}
        <View style={styles.rxRow}>
          <Text style={styles.rxLabel}>Rx ready</Text>
          <Switch
            value={rxReady}
            onValueChange={setRxReady}
            trackColor={{ false: "#C9C2B2", true: colors.ink }}
            thumbColor={colors.paper}
            // react-native-web-only props (absent from core RN types, hence
            // the cast); Android ignores them.
            {...({ activeThumbColor: colors.paper, activeTrackColor: colors.ink } as object)}
          />
        </View>
        <View style={styles.planWrap}>
          <Btn title="Plan route" onPress={plan} disabled={resolving || reading} variant="primary" full />
        </View>
        {active.id === HEB_ID ? (
          <View style={styles.row}>
            <Text style={styles.tryLabel}>TRY:</Text>
            <Btn title="Test A" onPress={() => { setText(TEST_A); setNotes([]); setError(null); setPhotoReason(null); }} variant="quiet" />
            <Btn title="Test B" onPress={() => { setText(TEST_B); setNotes([]); setError(null); setPhotoReason(null); }} variant="quiet" />
          </View>
        ) : null}
        {resolving ? <Text style={styles.hint}>Resolving with AI…</Text> : null}
        {reading ? <Text style={styles.hint}>Reading list…</Text> : null}
        {error ? (
          error === DEMO_LIMIT_TEXT ? (
            <View style={styles.limitBox}>
              <Text style={styles.limitText}>{error}</Text>
            </View>
          ) : (
            <Text style={styles.error}>{error}</Text>
          )
        ) : null}
        {photoReason ? <Text style={styles.hint}>{photoReason}</Text> : null}
        {unmatched.length > 0 ? (
          <Text style={styles.unmatched}>No match: {unmatched.join(", ")}</Text>
        ) : null}
        {card ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              QUICK QUESTION: {card.term}{cards.length > 1 ? ` · 1 OF ${cards.length}` : null}
            </Text>
            <Text style={styles.cardQuestion}>{card.question}</Text>
            {card.kind === "suggest" ? (
              <View style={styles.cardBtns}>
                <Btn title="Yes" onPress={() => void answerCard(card, card.options[0]!.productId)} variant="outline" full />
                <Btn title="No" onPress={() => void answerCard(card, null)} variant="outline" full />
              </View>
            ) : (
              <View style={styles.cardBtns}>
                {card.options.map((o) => (
                  <Btn key={o.productId} title={o.name} onPress={() => void answerCard(card, o.productId)} variant="outline" full />
                ))}
                <View style={styles.skipRight}>
                  <Btn title="Skip" onPress={() => void answerCard(card, null)} variant="quiet" />
                </View>
              </View>
            )}
          </View>
        ) : null}
        </>)}
        {route ? (
          <View style={styles.result}>
            {sh ? (
              <View style={styles.shopPanel}>
                <View style={styles.shopTop}>
                  <Text style={styles.shopTitle}>Aisle Line</Text>
                  <Text style={styles.shopMeta}>
                    Stop {sh.position} of {sh.total} · −{route.savingsPct}%
                  </Text>
                </View>
                <View style={styles.shopTrack}>
                  <View
                    style={[
                      styles.shopFill,
                      {
                        width: `${
                          sh.total > 0 ? Math.round(((sh.position - 1) / sh.total) * 100) : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
                <ScrollView style={styles.shopLine} nestedScrollEnabled>
                  <View style={styles.lineWrap}>
                    <View style={styles.rail} />
                    <View style={styles.lineRows}>
                      <View style={styles.lineRow}>
                        <View style={styles.endDot} />
                        <Text style={styles.endText}>
                          Enter · {doorLabel(active.doc, route.entranceId)}
                        </Text>
                      </View>
                      {route.stops.map((s, i) => (
                        <ShopLineRow
                          key={s.locationId + i}
                          stop={s}
                          state={stopRowState(shop, i)}
                          words={stopWords(s.productId, s.name, termsById)}
                        />
                      ))}
                      <View style={styles.lineRow}>
                        <View style={styles.endDot} />
                        <Text style={styles.endText}>
                          Exit · {doorLabel(active.doc, route.exitId)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </ScrollView>
                <View style={styles.legendRow}>
                  {legendEntries(route.stops).map((e) => (
                    <View key={e.label} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: e.color }]} />
                      <Text style={styles.legendText}>{e.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.shopBtns}>
                  <Btn
                    title="Skip for now"
                    onPress={() => setShop((s) => (s ? markSkipped(s) : s))}
                    variant="dark-outline"
                  />
                  <View style={styles.goWrap}>
                    <Btn
                      title="Got it"
                      onPress={() => setShop((s) => (s ? markGot(s) : s))}
                      variant="yellow"
                      full
                    />
                  </View>
                </View>
              </View>
            ) : shopSum ? (
              <View>
                <Text style={styles.doneTitle}>TRIP COMPLETE</Text>
                <View style={styles.doneRows}>
                  <Row left="GOT" right={`${shopSum.got}`} />
                  <Row
                    left="SKIPPED"
                    right={
                      shopSum.skipped > 0
                        ? `${shopSum.skipped} (${shopSum.skippedNames.join(", ")})`
                        : `${shopSum.skipped}`
                    }
                    tone={shopSum.skipped > 0 ? "red" : undefined}
                  />
                  <Row left="STOPS" right={`${shopSum.got + shopSum.skipped}`} />
                </View>
                <Divider />
                <Row left="YOU SAVED" right={`${route.savingsPct}%`} />
                <Text style={styles.hint}>vs. walking your list in typed order</Text>
                <View style={styles.stampWrap}>
                  <Stamp text="DONE · THANK YOU" size="big" />
                </View>
                <Btn title="Back to list" onPress={() => setShop(null)} variant="primary" full />
              </View>
            ) : (
              <View>
                <Divider />
                <Row left="IN" right={doorLabel(active.doc, route.entranceId)} />
                <Row left="OUT" right={doorLabel(active.doc, route.exitId)} />
                <Divider />
                <ScrollView
                  style={styles.stops}
                  contentContainerStyle={styles.stopsContent}
                  nestedScrollEnabled
                >
                  {route.stops.map((s, i) => (
                    <Row
                      key={s.locationId + i}
                      left={`${String(i + 1).padStart(2, "0")} ${s.instruction}`}
                      right={stopWords(s.productId, s.name, termsById) || s.name}
                      rightTone="muted"
                    />
                  ))}
                </ScrollView>
                <Divider />
                <Row left="YOU SAVED" right={`${route.savingsPct}%`} size={16} />
                <Text style={styles.hint}>vs. walking your list in typed order</Text>
                {route.savingsPct > 0 ? (
                  <View style={styles.stampWrap}>
                    <Stamp text="SHORTEST ROUTE" />
                  </View>
                ) : null}
                <Btn title="Start shopping" onPress={startShopping} variant="primary" full />
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
            <Btn title="Delete this store" onPress={confirmDeleteStore} variant="danger-text" />
          </View>
        ) : null}
      </GHScrollView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Explicit light background + dark text throughout: Android dark mode
  // (edge-to-edge, ignores userInterfaceStyle) must not restyle us.
  root: { flex: 1, backgroundColor: "#ffffff" },
  scroll: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingTop: 48, paddingBottom: 96, backgroundColor: colors.paper },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8, color: "#111827" },
  sectionLabel: {
    fontFamily: mono,
    color: colors.muted,
    fontSize: 13,
    letterSpacing: 2,
    marginBottom: 6,
  },
  storeBlock: { gap: 6, marginBottom: 8 },
  hint: { color: colors.muted, marginTop: 4, fontSize: 12, fontFamily: mono },
  input: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 0,
    backgroundColor: colors.white,
    padding: 10,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 8,
    color: "#111827",
    fontFamily: mono,
    fontSize: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" },
  rxRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  rxLabel: { color: "#111827", fontFamily: mono },
  planWrap: { marginBottom: 8 },
  tryLabel: { fontFamily: mono, color: colors.muted, fontSize: 13 },
  error: { color: colors.red, marginBottom: 8, fontFamily: mono },
  unmatched: { color: colors.red, marginBottom: 8, fontFamily: mono },
  limitBox: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.red,
    borderRadius: 0,
    padding: 10,
    marginBottom: 8,
  },
  limitText: { color: colors.red, fontFamily: mono },
  result: { marginTop: 4 },
  savings: { fontWeight: "bold", marginBottom: 4, color: "#111827" },
  card: {
    borderWidth: 2,
    borderColor: colors.red,
    borderRadius: 0,
    padding: 10,
    marginBottom: 8,
    backgroundColor: colors.white,
  },
  cardTitle: { fontWeight: "bold", marginBottom: 4, color: colors.red, fontFamily: mono },
  cardQuestion: { color: colors.ink, fontSize: 15, marginBottom: 6 },
  cardBtns: { gap: 6 },
  skipRight: { alignItems: "flex-end" },
  shopLabel: { fontSize: 24, fontWeight: "bold", marginBottom: 2, color: "#111827" },
  stops: { maxHeight: 110, marginBottom: 4 },
  stopsContent: { gap: 4 },
  stop: { marginBottom: 2, color: "#111827" },
  stampWrap: { marginVertical: 10 },
  doneTitle: {
    fontFamily: mono,
    fontSize: 20,
    letterSpacing: 3,
    color: colors.ink,
    textAlign: "center",
    marginBottom: 8,
  },
  savedWrap: { marginTop: 10, alignItems: "center", gap: 4 },
  savedNote: { fontFamily: mono, fontSize: 12, color: colors.muted, textAlign: "center" },
  doneRows: { gap: 4 },
  shopPanel: {
    backgroundColor: colors.shopDark,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },
  shopTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  shopTitle: { color: "#FFFFFF", fontSize: 15 },
  shopMeta: { color: "#8D939E", fontSize: 12 },
  shopTrack: {
    backgroundColor: "#2B2F37",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 10,
  },
  shopFill: { backgroundColor: colors.shopYellow, height: 6, borderRadius: 3 },
  shopLine: { maxHeight: 260 },
  lineWrap: { flexDirection: "row", gap: 10 },
  rail: { width: 6, borderRadius: 3, backgroundColor: "#2B2F37" },
  lineRows: { flex: 1, gap: 10 },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  endDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#8D939E" },
  endText: { color: "#8D939E", fontSize: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  skippedDot: { borderWidth: 2, backgroundColor: colors.shopDark },
  lineLabel: { color: "#FFFFFF", fontSize: 15 },
  lineSuffix: { color: "#8D939E", fontSize: 13 },
  doneLabel: { color: "#8D939E", fontSize: 15, textDecorationLine: "line-through" },
  currentBlock: { backgroundColor: "#22252C", borderRadius: 10, padding: 8 },
  currentDot: { borderWidth: 3, borderColor: colors.shopYellow },
  currentLabel: { color: "#FFFFFF", fontSize: 17 },
  currentWords: { color: colors.shopYellow, fontSize: 13 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: "#8D939E", fontSize: 12 },
  shopBtns: { flexDirection: "row", gap: 8, marginTop: 10 },
  goWrap: { flex: 2 },
  mapFrame: {
    height: 320,
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
