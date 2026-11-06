import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { Btn, Field, ScreenHeader, Txt, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function PartnerSignup() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { partnerSignup } = useAuth();
  const [f, setF] = useState({ org_code: "", name: "", agency: "", rera_id: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.org_code || !f.name || !f.agency || !f.email || !f.password) return toast.show("Fill all required fields", "error");
    setBusy(true);
    try {
      await partnerSignup(f);
      toast.show("Registered! Awaiting developer approval.");
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Partner onboarding" subtitle="Secure broker portal" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Txt variant="caption">Ask your developer for their organization code (demo: SKYLINE). Your PAN, GST and payout slabs are visible only to the developer&apos;s admin & finance team.</Txt>
        <Field label="Organization code *" testID="signup-org-code-input" value={f.org_code} onChangeText={set("org_code")} autoCapitalize="characters" placeholder="SKYLINE" />
        <Field label="Your name *" testID="signup-name-input" value={f.name} onChangeText={set("name")} placeholder="Full name" />
        <Field label="Agency name *" testID="signup-agency-input" value={f.agency} onChangeText={set("agency")} placeholder="Agency / firm" />
        <Field label="RERA agent ID" testID="signup-rera-input" value={f.rera_id} onChangeText={set("rera_id")} placeholder="Optional" />
        <Field label="Mobile" testID="signup-phone-input" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="10-digit mobile" />
        <Field label="Email *" testID="signup-email-input" value={f.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" placeholder="you@agency.com" />
        <Field label="Password *" testID="signup-password-input" value={f.password} onChangeText={set("password")} secureTextEntry placeholder="Min 8 characters" />
        <Btn title="Create partner account" testID="signup-submit-button" onPress={submit} loading={busy} />
      </KeyboardAwareScrollView>
    </View>
  );
}
