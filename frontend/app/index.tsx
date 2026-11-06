import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { Image } from "expo-image";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  if (loading) {
    return (
      <View style={[styles.c, { backgroundColor: colors.logoBg }]} testID="boot-splash">
        <Image source={require("../assets/images/logo.png")} style={styles.logo} contentFit="contain" />
        <ActivityIndicator color={colors.brandSecondary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (user.role === "global_admin") return <Redirect href="/admin" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24 },
  logo: { width: 160, height: 140 },
});
