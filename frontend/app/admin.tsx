import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { inr } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, Chip, ErrorState, Field, IconBtn, Row, ScreenHeader, Section, Sheet, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export default function AdminConsole() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", code: "", city: "", plan: "starter", admin_name: "", admin_email: "", admin_password: "" });
  const q = useQuery({ enabled: user?.role === "global_admin", queryKey: ["admin"], queryFn: () => api("/admin/overview") });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api(`/admin/orgs/${id}`, { method: "PATCH", body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast.show("Organization updated"); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  const create = useMutation({
    mutationFn: () => api("/admin/orgs", { body: f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); setOpen(false); toast.show("Organization onboarded (14-day trial)"); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "global_admin") return <Redirect href="/(tabs)" />;
  const d: any = q.data;
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const sc = (s: string) => (s === "active" ? colors.success : s === "trial" ? colors.brandSecondary : colors.error);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Platform console" subtitle="RCortexa Global Admin" right={<IconBtn icon="log-out-outline" testID="admin-logout-button" onPress={async () => { await logout(); router.replace("/login"); }} />} />
      {q.isLoading ? <SkeletonList /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
            {[["Organizations", d.metrics.orgs, "admin-metric-orgs"], ["Active", d.metrics.active, "admin-metric-active"], ["MRR", inr(d.metrics.mrr), "admin-metric-mrr"], ["Renewals ≤30d", d.metrics.renewals_30d, "admin-metric-renewals"]].map(([l, v, t]) => (
              <Card key={t as string} style={{ width: "47.5%", flexGrow: 1 }} testID={t as string}>
                <Txt variant="metric">{v as any}</Txt>
                <Txt variant="caption">{l as string}</Txt>
              </Card>
            ))}
          </View>
          <Btn title="Onboard organization" icon="add" testID="admin-onboard-button" onPress={() => setOpen(true)} style={{ marginTop: spacing.lg }} />
          <Section title="Tenants" />
          <View style={{ gap: spacing.md }}>
            {d.orgs.map((o: any) => (
              <Card key={o.id} testID={`org-card-${o.code}`}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{o.name}</Txt>
                    <Txt variant="caption">{o.code} · {o.city || "—"} · renews {new Date(o.renewal_date).toLocaleDateString("en-IN")}</Txt>
                  </View>
                  <Badge label={o.status.toUpperCase()} color={sc(o.status)} testID={`org-status-${o.code}`} />
                </Row>
                <Row style={{ marginTop: spacing.md, gap: spacing.xl }}>
                  <View><Txt variant="h2">{o.users}/{o.seats}</Txt><Txt variant="caption">seats</Txt></View>
                  <View><Txt variant="h2">{o.leads}</Txt><Txt variant="caption">leads</Txt></View>
                  <View><Txt variant="h2">{o.projects}</Txt><Txt variant="caption">projects</Txt></View>
                </Row>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}>
                  {d.plans.map((p: any) => <Chip key={p.id} label={`${p.name} ${inr(p.price)}`} selected={o.plan === p.id} onPress={() => o.plan !== p.id && patch.mutate({ id: o.id, body: { plan: p.id } })} testID={`org-plan-${o.code}-${p.id}`} />)}
                </ScrollView>
                <Row style={{ marginTop: spacing.md, gap: spacing.sm }}>
                  {o.status !== "active" && <Btn small title="Activate" testID={`org-activate-${o.code}`} onPress={() => patch.mutate({ id: o.id, body: { status: "active" } })} style={{ flex: 1 }} />}
                  {o.status !== "suspended" && <Btn small variant="danger" title="Suspend" testID={`org-suspend-${o.code}`} onPress={() => patch.mutate({ id: o.id, body: { status: "suspended" } })} style={{ flex: 1 }} />}
                </Row>
              </Card>
            ))}
          </View>
        </ScrollView>
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Onboard organization" testID="onboard-sheet">
        <Field label="Company name" testID="org-name-input" value={f.name} onChangeText={set("name")} />
        <Field label="Org code" testID="org-code-input" value={f.code} onChangeText={set("code")} autoCapitalize="characters" />
        <Field label="City" testID="org-city-input" value={f.city} onChangeText={set("city")} />
        <Row style={{ flexWrap: "wrap" }}>
          {["starter", "growth", "enterprise"].map((p) => <Chip key={p} label={p} selected={f.plan === p} onPress={() => set("plan")(p)} testID={`org-new-plan-${p}`} />)}
        </Row>
        <View style={{ height: 1, backgroundColor: colors.border, borderRadius: radius.sm }} />
        <Field label="Admin name" testID="org-admin-name-input" value={f.admin_name} onChangeText={set("admin_name")} />
        <Field label="Admin email" testID="org-admin-email-input" value={f.admin_email} onChangeText={set("admin_email")} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Admin password" testID="org-admin-password-input" value={f.admin_password} onChangeText={set("admin_password")} secureTextEntry />
        <Btn title="Create tenant" testID="org-create-submit" loading={create.isPending} onPress={() => create.mutate()} />
      </Sheet>
    </View>
  );
}
