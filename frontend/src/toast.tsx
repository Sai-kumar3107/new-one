import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@react-native-vector-icons/ionicons";

import { fonts, radius, spacing, useTheme } from "@/src/theme";

type Kind = "success" | "error" | "info";
type Toast = { id: number; msg: string; kind: Kind };
const Ctx = createContext<{ show: (msg: string, kind?: Kind) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const show = useCallback((msg: string, kind: Kind = "success") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), msg, kind });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const tint = toast?.kind === "error" ? colors.error : toast?.kind === "info" ? colors.brandSecondary : colors.success;
  const icon = toast?.kind === "error" ? "alert-circle" : toast?.kind === "info" ? "information-circle" : "checkmark-circle";

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
          <Animated.View
            key={toast.id}
            entering={FadeInUp.duration(220)}
            exiting={FadeOutUp.duration(180)}
            testID="toast-message"
            style={[styles.toast, { backgroundColor: colors.surfaceInverse }]}
          >
            <Ionicons name={icon} size={20} color={tint} />
            <Text style={[styles.text, { color: colors.onSurfaceInverse }]} numberOfLines={3}>
              {toast.msg}
            </Text>
          </Animated.View>
        </View>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, alignItems: "center", zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    maxWidth: 520,
    width: "100%",
  },
  text: { flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
});
