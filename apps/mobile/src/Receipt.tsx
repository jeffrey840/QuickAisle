import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono } from "./theme";

/** Tiny presentational receipt pieces. No state, no logic. */

/** 1px divider (no dashed borders — Android draws them wrong). */
export function Divider() {
  return <View style={styles.divider} />;
}

/** Left/right row, e.g. an item line with a price. Displays uppercase. */
export function Row({
  left,
  right,
  tone,
  rightTone,
  size,
}: {
  left: string;
  right: string;
  tone?: "muted" | "red";
  rightTone?: "muted" | "red";
  size?: number;
}) {
  const leftStyle = [styles.rowText, tone === "muted" && styles.muted, tone === "red" && styles.redText];
  const rightStyle = [
    styles.rowText,
    (rightTone ?? tone) === "muted" && styles.muted,
    (rightTone ?? tone) === "red" && styles.redText,
  ];
  return (
    <View style={styles.row}>
      <Text style={size ? [...leftStyle, { fontSize: size }] : leftStyle}>{left}</Text>
      <Text style={size ? [...rightStyle, { fontSize: size }] : rightStyle}>{right}</Text>
    </View>
  );
}

/** Red stamp label, slightly rotated. size "big" is the 20px trip stamp. */
export function Stamp({ text, size }: { text: string; size?: number | "big" }) {
  return (
    <View style={styles.stamp}>
      <Text style={[styles.stampText, { fontSize: size === "big" ? 20 : (size ?? 14) }]}>
        {text}
      </Text>
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
  rowText: { fontFamily: mono, fontSize: 13, color: colors.ink, textTransform: "uppercase" },
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
