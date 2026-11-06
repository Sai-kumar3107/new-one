import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, StyleSheet, View } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { ToastProvider } from "@/src/toast";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  const { colors } = useTheme();
  // Prewarm icon + brand fonts before first paint (fixes icons not loading in Expo Go Android).
  const [loaded, error] = useFonts({
    Ionicons: require("@react-native-vector-icons/ionicons/fonts/Ionicons.ttf"),
    "SpaceGrotesk-500": require("../assets/fonts/SpaceGrotesk-500.ttf"),
    "SpaceGrotesk-700": require("../assets/fonts/SpaceGrotesk-700.ttf"),
    "Jakarta-400": require("../assets/fonts/PlusJakartaSans-400.ttf"),
    "Jakarta-500": require("../assets/fonts/PlusJakartaSans-500.ttf"),
    "Jakarta-600": require("../assets/fonts/PlusJakartaSans-600.ttf"),
    "Jakarta-700": require("../assets/fonts/PlusJakartaSans-700.ttf"),
  });

  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.logoBg }} />;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <ToastProvider>
                <AuthProvider>
                  <StatusBar style="light" />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
                    <Stack.Screen name="unit/[id]" options={{ presentation: "modal" }} />
                  </Stack>
                </AuthProvider>
              </ToastProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
