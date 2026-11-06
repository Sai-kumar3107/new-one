import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { inrFull, timeAgo } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, EmptyState, ErrorState, KV, Row, ScreenHeader, Section, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { confirmAsk } from "@/src/manage/helpers";

/** Organization Admin only — the backend returns 403 for every other role. */
export default function Subscription() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const allowed = user?.role === "org_admin";
  const q = useQuery({ enabled: allowed, queryKey: ["subscription"], queryFn: () => api<any>("/org/subscription") });
  const [busy, setBusy] = useState<string | null>(null);

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader back title="Subscription" />
        <EmptyState icon="lock-closed-outline" title="Admins only" sub="Only your organization admin can view subscription and billing." testID="subscription-denied" />
      </View>
    );
  }

  const request = async (plan: any) => {
    if (!(await confirmAsk(`Request ${plan.name}?`, `RCortexa will review your request to switch to ${plan.name} (${inrFull(plan.price)}/month) and confirm before any change.`, "Send request"))) return;
    setBusy(plan.id);
    try {
      await api("/org/subscription/request", { body: { plan: plan.id } });
      toast.show("Plan change request sent");
      q.refetch();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const d = q.data;
  const bar = (used: number, max: number, id: string) => (
    <View style={{ gap: 6, marginTop: spacing.sm }} testID={id}>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" }}>
        <View style={{ height: 8, width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%`, backgroundColor: used >= max ? colors.error : colors.brandSecondary }} />
      </View>
      <Txt variant="caption">{used} of {max} used</Txt>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Subscription & billing" subtitle="Visible to organization admins only" testID="subscription-header" />
      {q.isLoading ? <SkeletonList n={3} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
          <Card testID="subscription-current">
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="h2">{d.plan.name}</Txt>
              <Badge label={d.org.status.toUpperCase()} color={d.org.status === "active" ? colors.success : d.org.status === "trial" ? colors.brandTertiary : colors.error} />
            </Row>
            <KV k="Price" v={`${inrFull(d.plan.price)} / month`} testID="subscription-price" />
            <KV k="Billing cycle" v="Monthly" />
            <KV k={d.org.status === "trial" ? "Trial ends" : "Renews on"} v={d.org.renewal_date ? new Date(d.org.renewal_date).toLocaleDateString("en-IN") : "—"} />
            <KV k="AI credits / month" v={d.plan.ai_credits.toLocaleString("en-IN")} />
          </Card>
          <Section title="Usage" />
          <Card>
            <Txt variant="bodyStrong">Team seats</Txt>
            {bar(d.usage.seats, d.usage.seat_limit, "subscription-seats")}
            <Txt variant="bodyStrong" style={{ marginTop: spacing.lg }}>Active projects</Txt>
            {bar(d.usage.projects, d.usage.project_limit, "subscription-projects")}
          </Card>
          <Section title="Plans" />
          <View style={{ gap: spacing.sm }}>
            {d.plans.map((p: any) => (
              <Card key={p.id} testID={`subscription-plan-${p.id}`} style={p.id === d.plan.id ? { borderColor: colors.brandSecondary } : undefined}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{p.name}</Txt>
                    <Txt variant="caption">{p.seats} seats · {p.projects} projects · {p.ai_credits.toLocaleString("en-IN")} AI credits</Txt>
                  </View>
                  <Txt variant="bodyStrong">{inrFull(p.price)}/mo</Txt>
                </Row>
                {p.id === d.plan.id ? <View style={{ marginTop: spacing.sm }}><Badge label="CURRENT PLAN" color={colors.brandSecondary} /></View> : (
                  <Btn small variant="secondary" style={{ marginTop: spacing.md }} title={p.price > d.plan.price ? "Request upgrade" : "Request downgrade"}
                    testID={`subscription-request-${p.id}`} loading={busy === p.id} onPress={() => request(p)} />
                )}
              </Card>
            ))}
          </View>
          <Section title="History" />
          <Card testID="subscription-history">
            {d.history.length === 0 ? <Txt variant="caption">No subscription changes yet.</Txt> : d.history.map((h: any, i: number) => (
              <Row key={i} style={{ paddingVertical: 6, alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="body">{h.action === "plan_request" ? "Change requested" : h.action === "onboard" ? "Organization created" : "Updated by RCortexa"}</Txt>
                  <Txt variant="caption">{h.detail}</Txt>
                </View>
                <Txt variant="caption">{timeAgo(h.created_at)}</Txt>
              </Row>
            ))}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
