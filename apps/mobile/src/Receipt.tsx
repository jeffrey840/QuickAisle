import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono } from "./theme";

/** Tiny presentational receipt pieces. No state, no logic. */

/** 1px divider (no dashed borders — Android draws them wrong). */
export function Divider() {
  return <View style={styles.divider} />;
}

/** Left/right row, e.g. an item line with a price. */
export function Row({
  left,
  right,
  tone,
}: {
  left: string;
  right: string;
  tone?: "muted" | "red";
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowText, tone === "muted" && styles.muted, tone === "red" && styles.redText]}>
        {left}
      </Text>
      <Text style={[styles.rowText, tone === "muted" && styles.muted, tone === "red" && styles.redText]}>
        {right}
      </Text>
    </View>
  );
}

/** Red stamp label, slightly rotated. */
export function Stamp({ text, size }: { text: string; size?: number }) {
  return (
    <View style={styles.stamp}>
      <Text style={[styles.stampText, { fontSize: size ?? 14 }]}>{text}</Text>
    </View>
  );
}

/** Centered receipt header; the subtitle taps when a handler is given. */
export function Header({
  subtitle,
  onPressSubtitle,
}: {
  subtitle: string;
  onPressSubtitle?: () => void;
}) {
  return (
    <View>
      <Text style={styles.headerTitle}>QUICKAISLE</Text>
      {onPressSubtitle ? (
        <Pressable onPress={onPressSubtitle} accessibilityRole="button" accessibilityLabel={subtitle}>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </Pressable>
      ) : (
        <Text style={styles.subtitle}>{subtitle}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { backgroundColor: colors.line, height: 1, marginVertical: 6 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowText: { fontFamily: mono, fontSize: 13, color: colors.ink },
  muted: { color: colors.muted },
  redText: { color: colors.red },
  stamp: {
    borderWidth: 2,
    borderColor: colors.red,
    paddingHorizontal: 10,
    paddingVertical: 4,
    transform: [{ rotate: "-4deg" }],
    alignSelf: "center",
  },
  stampText: { color: colors.red, fontFamily: mono, fontWeight: "bold" },
  headerTitle: {
    fontFamily: mono,
    fontSize: 20,
    letterSpacing: 3,
    textAlign: "center",
    color: colors.ink,
  },
  subtitle: { fontFamily: mono, fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 4 },
});
