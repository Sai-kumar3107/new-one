import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { Btn, Chip, Field, Pressy, Txt } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO = "https://images.pexels.com/photos/34533543/pexels-photo-34533543.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";
const DEMO = [
  { label: "Org Admin", email: "orgadmin@skyline.com", pw: "Admin@123" },
  { label: "Sales Exec", email: "sales1@skyline.com", pw: "Sales@123" },
  { label: "Finance", email: "finance@skyline.com", pw: "Finance@123" },
  { label: "Channel Partner", email: "partner@skyline.com", pw: "Partner@123" },
  { label: "Global Admin", email: "admin@rcortexa.com", pw: "Admin@123" },
];

export default function Login() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !pw) return toast.show("Enter email and password", "error");
    setBusy(true);
    try {
      const u = await login(email, pw);
      router.replace(u.role === "global_admin" ? "/admin" : "/(tabs)");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={s.hero}>
          <Image source={{ uri: HERO }} style={s.heroImg} contentFit="cover" transition={300} />
          <LinearGradient colors={["transparent", colors.scrim, colors.surface]} style={s.heroScrim} />
          <View style={[s.heroContent, { paddingTop: insets.top + spacing.lg }]}>
            <View style={s.logoWrap}>
              <Image source={require("../assets/images/logo.png")} style={s.logo} contentFit="contain" />
            </View>
            <Animated.View entering={FadeInDown.duration(500)}>
              <Txt variant="label" color={colors.brandTertiary}>RCortexa</Txt>
              <Txt variant="display" style={{ marginTop: spacing.sm }}>The AI Brain{"\n"}Behind Real Estate.</Txt>
              <Txt variant="body" color={colors.muted} style={{ marginTop: spacing.sm }}>
                Leads, live inventory, partners and AI — one command center.
              </Txt>
            </Animated.View>
          </View>
        </View>

        <Animated.View entering={FadeInDown.delay(120).duration(500)} style={s.form}>
          <Field label="Work email" testID="login-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@company.com" autoComplete="email" />
          <Field label="Password" testID="login-password-input" value={pw} onChangeText={setPw} secureTextEntry placeholder="••••••••" onSubmitEditing={submit} />
          <Btn title="Sign in" testID="login-submit-button" onPress={submit} loading={busy} icon="arrow-forward" />

          <View style={{ gap: spacing.sm }}>
            <Txt variant="label">Demo accounts</Txt>
            <View style={s.demoWrap}>
              {DEMO.map((d) => (
                <Chip key={d.email} label={d.label} testID={`demo-${d.label.toLowerCase().replace(/ /g, "-")}`} selected={email === d.email} onPress={() => { setEmail(d.email); setPw(d.pw); }} />
              ))}
            </View>
          </View>

          <Pressy testID="partner-signup-link" onPress={() => router.push("/partner-signup")} style={s.partnerCard}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Channel partner or broker?</Txt>
              <Txt variant="caption">Register your agency and lock client leads</Txt>
            </View>
            <Txt variant="bodyStrong" color={colors.brandSecondary}>Join →</Txt>
          </Pressy>
        </Animated.View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { height: 420 },
  heroImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroContent: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: spacing.xl, justifyContent: "space-between", paddingBottom: spacing.lg },
  logoWrap: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: c.logoBg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  logo: { width: 56, height: 50 },
  form: { paddingHorizontal: spacing.xl, gap: spacing.lg, width: "100%", maxWidth: 520, alignSelf: "center" },
  demoWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  partnerCard: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
}));
