import React, { useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons } from "@react-native-vector-icons/ionicons";

import { fonts, makeStyles, radius, spacing, useTheme, ThemeColors } from "@/src/theme";

export { Ionicons as Icon };
export type IconName = React.ComponentProps<typeof Ionicons>["name"];

// ---------- Responsive layout ----------
// One codebase for phones, tablets, laptops and desktop browsers: content is capped and centred on wide screens.
export const CONTENT_MAX = 1120;
export const centered: ViewStyle = { width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" };

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, wide: width >= 768, xl: width >= 1200, cols: width >= 1200 ? 3 : width >= 768 ? 2 : 1, gutter: Math.max(spacing.lg, (width - CONTENT_MAX) / 2 + spacing.lg) };
}

// ---------- Text ----------
type Variant = "display" | "title" | "h2" | "h3" | "body" | "bodyStrong" | "caption" | "label" | "metric";
const variantStyle: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 38, letterSpacing: -0.8 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  h3: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: "uppercase" },
  metric: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
};

export function Txt({ variant = "body", color, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  const { colors } = useTheme();
  const defaultColor = variant === "caption" || variant === "label" ? colors.muted : colors.onSurface;
  return <Text {...rest} style={[variantStyle[variant], { color: color ?? defaultColor }, style]} />;
}

// ---------- Pressable with scale ----------
export function Pressy({ style, children, onPressIn, onPressOut, haptic, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: boolean; children?: React.ReactNode }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        s.value = withSpring(0.97, { damping: 18, stiffness: 400 });
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 18, stiffness: 400 });
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[a, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------- Button ----------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "light";
export function Btn({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  testID,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const map: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    secondary: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
    ghost: { bg: "transparent", fg: colors.onSurface, border: colors.border },
    danger: { bg: colors.surfaceTertiary, fg: colors.error },
    light: { bg: colors.surfaceInverse, fg: colors.onSurfaceInverse },
  };
  const c = map[variant];
  return (
    <Pressy
      testID={testID}
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={[
        {
          height: small ? 40 : 52,
          paddingHorizontal: small ? spacing.md : spacing.xl,
          borderRadius: radius.pill,
          backgroundColor: c.bg,
          borderWidth: c.border ? 1 : 0,
          borderColor: c.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 18} color={c.fg} />}
          <Text style={{ color: c.fg, fontFamily: fonts.bold, fontSize: small ? 13 : 15 }}>{title}</Text>
        </>
      )}
    </Pressy>
  );
}

// ---------- Card ----------
export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={[{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }, style]}
    >
      {children}
    </View>
  );
}

// ---------- Chips ----------
export function Chip({ label, selected, onPress, testID, dot, count }: { label: string; selected?: boolean; onPress?: () => void; testID?: string; dot?: string; count?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={{
        height: 36,
        flexShrink: 0,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.surfaceInverse : colors.border,
        backgroundColor: selected ? colors.surfaceInverse : colors.surfaceSecondary,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: selected ? colors.onSurfaceInverse : colors.onSurfaceSecondary }}>{label}</Text>
      {count !== undefined && <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: selected ? colors.onSurfaceInverse : colors.muted }}>{count}</Text>}
    </Pressable>
  );
}

export function ChipRow({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { gutter } = useLayout();
  return (
    <View style={{ height: 56, justifyContent: "center" }}>
      <ScrollView
        testID={testID}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: gutter, alignItems: "center" }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ---------- Badges ----------
export function Badge({ label, color, testID }: { label: string; color: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, height: 22, borderRadius: radius.pill, backgroundColor: `${color}22`, alignSelf: "flex-start" }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 11, color }}>{label}</Text>
    </View>
  );
}

export function tierColor(colors: ThemeColors, tier?: string) {
  return tier === "Hot" ? colors.brandTertiary : tier === "Warm" ? colors.warning : colors.brandSecondary;
}

export function statusColor(colors: ThemeColors, s?: string) {
  return s === "available" ? colors.success : s === "reserved" ? colors.warning : s === "sold" ? colors.error : colors.info;
}

export function TierBadge({ tier, score, testID }: { tier?: string; score?: number; testID?: string }) {
  const { colors } = useTheme();
  return <Badge testID={testID} label={`${tier ?? "—"} ${score ?? ""}`.trim()} color={tierColor(colors, tier)} />;
}

// ---------- Avatar ----------
export function Avatar({ name, size = 40, online }: { name?: string; size?: number; online?: boolean }) {
  const { colors } = useTheme();
  const initials = (name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: size * 0.36, color: colors.onSurface }}>{initials}</Text>
      </View>
      {online !== undefined && (
        <View style={{ position: "absolute", right: 0, bottom: 0, width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: online ? colors.success : colors.muted, borderWidth: 2, borderColor: colors.surfaceSecondary }} />
      )}
    </View>
  );
}

// ---------- Skeleton ----------
export function Skeleton({ h = 16, w = "100%", r = radius.md, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.9, { duration: 800 }), -1, true);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: colors.surfaceTertiary }, a, style]} />;
}

export function SkeletonList({ n = 5, h = 84 }: { n?: number; h?: number }) {
  return (
    <View style={{ gap: spacing.md, padding: spacing.lg }} testID="loading-skeleton">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} h={h} r={radius.lg} />
      ))}
    </View>
  );
}

// ---------- Empty / Error ----------
export function EmptyState({ icon = "file-tray-outline", title, sub, action, testID }: { icon?: IconName; title: string; sub?: string; action?: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID ?? "empty-state"} style={{ alignItems: "center", padding: spacing.xxl, gap: spacing.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm }}>
        <Ionicons name={icon} size={28} color={colors.muted} />
      </View>
      <Txt variant="h3" style={{ textAlign: "center" }}>{title}</Txt>
      {sub && <Txt variant="caption" style={{ textAlign: "center" }}>{sub}</Txt>}
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <EmptyState
      testID="error-state"
      icon="cloud-offline-outline"
      title="Could not load data"
      sub={message ?? "Check your connection and try again."}
      action={<Btn small title="Retry sync" icon="refresh" onPress={onRetry} testID="retry-button" style={{ marginTop: spacing.md }} />}
    />
  );
}

// ---------- Header ----------
export function ScreenHeader({ title, subtitle, back, right, testID }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <View style={[centered, { flexDirection: "row", alignItems: "center", gap: spacing.md }]}>
      {back && (
        <Pressy testID="header-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressy>
      )}
      <View style={{ flex: 1 }}>
        <Txt variant={back ? "h2" : "title"} numberOfLines={1}>{title}</Txt>
        {subtitle && <Txt variant="caption" numberOfLines={1}>{subtitle}</Txt>}
      </View>
      {right}
      </View>
    </View>
  );
}

export function IconBtn({ icon, onPress, testID, badge }: { icon: IconName; onPress: () => void; testID?: string; badge?: number }) {
  const { colors } = useTheme();
  return (
    <Pressy testID={testID} onPress={onPress} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
      <Ionicons name={icon} size={20} color={colors.onSurface} />
      {!!badge && (
        <View style={{ position: "absolute", top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <Text style={{ color: colors.onBrandTertiary, fontSize: 10, fontFamily: fonts.bold }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </Pressy>
  );
}

// ---------- Section title ----------
export function Section({ title, action, onAction, testID }: { title: string; action?: string; onAction?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md }}>
      <Txt variant="label">{title}</Txt>
      {action && (
        <Pressable testID={testID} onPress={onAction} hitSlop={12}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.brandSecondary }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------- Field ----------
export function Field({ label, style, ...rest }: TextInputProps & { label: string }) {
  const s = useFieldStyles();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{label}</Txt>
      <TextInput placeholderTextColor={colors.muted} {...rest} style={[s.input, style]} />
    </View>
  );
}
const useFieldStyles = makeStyles((c) => ({
  input: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.surfaceTertiary,
    color: c.onSurfaceTertiary,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: 15,
    borderWidth: 1,
    borderColor: c.border,
    ...webNoOutline,
  },
}));
// Browsers draw a focus ring on inputs; the themed border already shows focus context.
export const webNoOutline: TextStyle = Platform.OS === "web" ? ({ outlineStyle: "none" } as TextStyle) : {};

// ---------- Bottom sheet ----------
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={{ ...StyleFill, backgroundColor: colors.backdrop }} onPress={onClose} testID="sheet-backdrop" />
        <View testID={testID} style={{ width: "100%", maxWidth: 640, alignSelf: "center", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.lg, maxHeight: "88%", borderWidth: 1, borderColor: colors.border }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surfaceTertiary, marginBottom: spacing.md }} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
            <Txt variant="h2" style={{ flex: 1 }}>{title}</Txt>
            <Pressable onPress={onClose} hitSlop={12} testID="sheet-close-button">
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const StyleFill = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

export function Row({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View testID={testID} style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, style]}>{children}</View>;
}

export function KV({ k, v, testID }: { k: string; v?: string | number | null; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
      <Txt variant="caption">{k}</Txt>
      <Txt variant="bodyStrong" testID={testID}>{v ?? "—"}</Txt>
    </View>
  );
}

export function DemoTag() {
  const { colors } = useTheme();
  return <Badge label="DEMO MODE" color={colors.brandTertiary} />;
}
