// Design tokens for RCortexa. Dark-first (Glass / Luxe DARK) per /app/design_guidelines.json.
// A plain key is a background and its `on` partner is the text/icon color on top of it.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0B0B0D",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#17181C",
  onSurfaceSecondary: "#FFFFFF",
  surfaceTertiary: "#252831",
  onSurfaceTertiary: "#F6F7F9",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0B0B0D",
  muted: "#8B909B",

  brand: "#315CFF",
  onBrand: "#FFFFFF",
  brandPrimary: "#315CFF",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#6C8CFF",
  onBrandSecondary: "#0B0B0D",
  brandTertiary: "#FF7A1A",
  onBrandTertiary: "#FFFFFF",

  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#0B0B0D",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#8B909B",
  onInfo: "#FFFFFF",

  border: "#252831",
  borderStrong: "#E5E7EB",
  divider: "#17181C",

  // extras
  logoBg: "#0B1229",
  scrim: "rgba(11,11,13,0.78)",
  backdrop: "rgba(0,0,0,0.6)",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// Single dark theme: keep native chrome dark too.
setColorScheme?.(defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const fonts = {
  display: "SpaceGrotesk-500",
  displayBold: "SpaceGrotesk-700",
  body: "Jakarta-400",
  medium: "Jakarta-500",
  semibold: "Jakarta-600",
  bold: "Jakarta-700",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
