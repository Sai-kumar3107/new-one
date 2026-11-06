import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isAdminish, useAuth } from "@/src/auth";
import { ROLE_LABEL } from "@/src/format";
import { Avatar, Badge, Btn, Card, Icon, IconName, KV, Pressy, Row, ScreenHeader, Section, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

const INTEGRATIONS: { name: string; status: "demo" | "off" | "on"; icon: IconName }[] = [
  { name: "WhatsApp Business API", status: "demo", icon: "logo-whatsapp" },
  { name: "AI Voice Agent (telephony)", status: "demo", icon: "mic-outline" },
  { name: "AI assistant & scoring", status: "on", icon: "sparkles-outline" },
  { name: "Meta Lead Ads", status: "off", icon: "logo-facebook" },
  { name: "Google Ads lead forms", status: "off", icon: "logo-google" },
  { name: "MagicBricks / 99acres / Justdial", status: "off", icon: "globe-outline" },
];

export default function Profile() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, org, logout } = useAuth();
  const links: { label: string; icon: IconName; to: any; show: boolean; id: string }[] = [
    { label: "Projects & inventory", icon: "business-outline", to: "/manage/projects", show: user?.role === "org_admin", id: "manage-projects" },
    { label: "Subscription & billing", icon: "card-outline", to: "/subscription", show: user?.role === "org_admin", id: "subscription" },
    { label: "Attendance", icon: "finger-print-outline", to: "/attendance", show: !!user && user.role !== "channel_partner" && user.role !== "global_admin", id: "attendance" },
    { label: "Site visits", icon: "calendar-outline", to: "/visits", show: user?.role !== "channel_partner", id: "visits" },
    { label: user?.role === "channel_partner" ? "My commissions" : "Partners & commissions", icon: "briefcase-outline", to: "/partners", show: isAdminish(user?.role) || user?.role === "channel_partner", id: "partners" },
    { label: "Team & live status", icon: "people-outline", to: "/team", show: isAdminish(user?.role), id: "team" },
    { label: "Audit log", icon: "shield-checkmark-outline", to: "/audit", show: user?.role === "org_admin", id: "audit" },
  ];
  const sc = (s: string) => (s === "on" ? colors.success : s === "demo" ? colors.brandTertiary : colors.muted);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Profile" />
      <ScrollView contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Row style={{ gap: spacing.lg }}>
          <Avatar name={user?.name} size={64} />
          <View style={{ flex: 1 }}>
            <Txt variant="h2" testID="profile-name">{user?.name}</Txt>
            <Txt variant="caption">{user?.email}</Txt>
            <View style={{ marginTop: 6 }}><Badge label={ROLE_LABEL[user?.role ?? ""]} color={colors.brandSecondary} testID="profile-role" /></View>
          </View>
        </Row>
        {org && (
          <Card style={{ marginTop: spacing.xl, paddingVertical: spacing.sm }}>
            <KV k="Organization" v={org.name} />
            <KV k="Org code" v={org.code} testID="profile-org-code" />
            {user?.role === "org_admin" && <KV k="Plan" v={`${org.plan} · ${org.seats} seats`} testID="profile-plan" />}
            {user?.role === "org_admin" && <KV k="Renewal" v={org.renewal_date ? new Date(org.renewal_date).toLocaleDateString("en-IN") : "—"} />}
          </Card>
        )}
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {links.filter((l) => l.show).map((l) => (
            <Pressy key={l.id} testID={`profile-link-${l.id}`} onPress={() => router.push(l.to)}>
              <Row style={{ padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
                <Icon name={l.icon} size={20} color={colors.onSurface} />
                <Txt variant="bodyStrong" style={{ flex: 1 }}>{l.label}</Txt>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Row>
            </Pressy>
          ))}
        </View>
        {user?.role === "org_admin" && (
          <>
            <Section title="Integrations" />
            <Card style={{ paddingVertical: spacing.sm }} testID="integrations-card">
              {INTEGRATIONS.map((i) => (
                <Row key={i.name} style={{ paddingVertical: spacing.sm, gap: spacing.md }}>
                  <Icon name={i.icon} size={18} color={colors.muted} />
                  <Txt variant="body" style={{ flex: 1 }}>{i.name}</Txt>
                  <Badge label={i.status === "on" ? "CONNECTED" : i.status === "demo" ? "DEMO" : "NOT CONNECTED"} color={sc(i.status)} />
                </Row>
              ))}
            </Card>
          </>
        )}
        <Btn title="Sign out" variant="danger" icon="log-out-outline" testID="logout-button" style={{ marginTop: spacing.xl }} onPress={async () => { await logout(); router.replace("/login"); }} />
      </ScrollView>
    </View>
  );
}
