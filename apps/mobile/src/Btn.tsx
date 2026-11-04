import { Pressable, StyleSheet, Text } from "react-native";
import { colors, mono } from "./theme";

export type BtnVariant = "primary" | "outline" | "selected" | "danger-text" | "quiet";

/**
 * The one styled button (Android's built-in Button can't be styled).
 * Titles pass through verbatim and only DISPLAY uppercase via
 * textTransform, so user data like store names is untouched.
 */
export default function Btn({
  title,
  onPress,
  disabled,
  variant,
  full,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant: BtnVariant;
  full?: boolean;
}) {
  const filled = variant === "primary" || variant === "selected";
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled ?? false }}
      style={({ pressed }) => [
        styles.base,
        filled ? styles.filled : null,
        variant === "outline" ? styles.outline : null,
        full ? styles.full : null,
        disabled ? styles.disabledBox : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.text,
          filled ? styles.filledText : null,
          variant === "danger-text" ? styles.dangerText : null,
          variant === "quiet" ? styles.quietText : null,
          disabled ? styles.disabledText : null,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const DISABLED_BORDER = "#C9C2B2";
const DISABLED_TEXT = "#A49D8E";

const styles = StyleSheet.create({
  base: { borderRadius: 0, paddingHorizontal: 12, paddingVertical: 10 },
  filled: { backgroundColor: colors.ink },
  outline: { borderWidth: 1.5, borderColor: colors.ink },
  full: { width: "100%" },
  disabledBox: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: DISABLED_BORDER },
  pressed: { opacity: 0.7 },
  text: {
    fontFamily: mono,
    fontSize: 14,
    color: colors.ink,
    textAlign: "center",
    textTransform: "uppercase",
  },
  filledText: { color: colors.paper, letterSpacing: 1 },
  dangerText: { color: colors.red },
  quietText: { color: colors.muted },
  disabledText: { color: DISABLED_TEXT },
});
