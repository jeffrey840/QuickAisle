import { Platform } from "react-native";

/** Receipt-style palette. */
export const colors = {
  paper: "#FBF8F1",
  ink: "#1C1C1C",
  muted: "#6B6558",
  line: "#9A9384",
  red: "#C2362B",
  darkRed: "#8E2219",
  white: "#FFFFFF",
  shopDark: "#16181D",
  shopYellow: "#FFC93C",
} as const;

/** Typewriter look via the system monospace (no font packages). */
export const mono = Platform.select({
  android: "monospace",
  ios: "Menlo",
  default: "ui-monospace, Menlo, Consolas, monospace",
});
