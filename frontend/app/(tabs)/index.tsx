import { RefreshControl, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { isAdminish, useAuth } from "@/src/auth";
import { fmtDateTime, inr, inrFull, ROLE_LABEL, sourceLabel, STAGE_LABEL, STAGES, timeAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { Avatar, Badge, Btn, Card, ErrorState, Icon, IconBtn, IconName, Pressy, Row, Section, Skeleton, statusColor, tierColor, Txt, centered, useLayout } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Dashboard() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, org } = useAuth();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api("/dashboard") });
  const notif = useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications") });
  const d: any = q.data;
  const { gutter } = useLayout();

  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
      <View style={{ flex: 1 }}>
        <Txt variant="caption">{org?.name} · {ROLE_LABEL[user?.role ?? ""]}</Txt>
        <Txt variant="title" testID="dashboard-greeting">Hi, {user?.name?.split(" ")[0]}</Txt>
      </View>
      <IconBtn icon="notifications-outline" testID="notifications-button" badge={(notif.data as any)?.unread} onPress={() => router.push("/notifications")} />
      <Pressy testID="profile-button" onPress={() => router.push("/profile")}>
        <Avatar name={user?.name} size={44} />
      </Pressy>
    </View>
  );

  return (
    <View style={s.root}>
      {header}
      {q.isLoading ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }} testID="loading-skeleton">
          <Skeleton h={170} r={radius.lg} />
          <Row><Skeleton h={100} w="48%" r={radius.lg} /><Skeleton h={100} w="48%" r={radius.lg} /></Row>
          <Skeleton h={140} r={radius.lg} />
        </View>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: bottomChrome + spacing.xl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => { q.refetch(); notif.refetch(); }} />}
        >
          {user?.role === "channel_partner" ? <PartnerHome d={d} /> : <InternalHome d={d} />}
        </ScrollView>
      )}
    </View>
  );
}

function Metric({ label, value, icon, testID, accent }: { label: string; value: string | number; icon: IconName; testID: string; accent?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { wide } = useLayout();
  return (
    <View style={[s.metric, wide && { width: "23%" }]} testID={testID}>
      <Icon name={icon} size={18} color={accent ?? colors.muted} />
      <Txt variant="metric" style={{ marginTop: spacing.md }}>{value}</Txt>
      <Txt variant="caption">{label}</Txt>
    </View>
  );
}

function Bar({ parts }: { parts: { v: number; c: string }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 }}>
      {parts.filter((p) => p.v > 0).map((p, i) => <View key={i} style={{ flex: p.v / total, backgroundColor: p.c }} />)}
    </View>
  );
}

function InternalHome({ d }: { d: any }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const inv = d.inventory;
  const maxStage = Math.max(1, ...STAGES.map((st) => d.by_stage[st]));
  const quick: { label: string; icon: IconName; to: any; show: boolean; id: string }[] = [
    { label: "Site visits", icon: "calendar-outline", to: "/visits", show: true, id: "visits" },
    { label: "Partners", icon: "briefcase-outline", to: "/partners", show: isAdminish(user?.role), id: "partners" },
    { label: "Team", icon: "people-circle-outline", to: "/team", show: isAdminish(user?.role), id: "team" },
    { label: "Audit log", icon: "shield-checkmark-outline", to: "/audit", show: user?.role === "org_admin", id: "audit" },
  ];
  return (
    <>
      <Animated.View entering={FadeInDown.duration(400)}>
        <LinearGradient colors={[colors.surfaceTertiary, colors.surfaceSecondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt variant="label">{user?.role === "sales_exec" ? "My bookings value" : "Revenue booked"}</Txt>
            <Badge label="LIVE" color={colors.success} />
          </Row>
          <Txt variant="display" testID="dashboard-revenue" style={{ marginTop: spacing.sm }}>{inr(d.revenue)}</Txt>
          <Txt variant="caption">{d.units_sold} units sold · {d.conversion_rate}% close rate</Txt>
          <View style={s.forecast}>
            <Icon name="sparkles" size={16} color={colors.brandTertiary} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" testID="dashboard-forecast">AI forecast {inr(d.forecast.revenue)} · ~{d.forecast.expected_bookings} bookings</Txt>
              <Txt variant="caption">{d.forecast.assumption}</Txt>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      {user?.role === "sales_exec" && (
        <Card style={{ marginTop: spacing.md }} testID="my-earnings-card">
          <Txt variant="label">My incentive earnings</Txt>
          <Txt variant="metric" style={{ marginTop: spacing.sm }}>{inrFull(d.my_earnings)}</Txt>
          <Txt variant="caption">Sold {d.units_sold} units @ {inrFull(d.incentive_per_unit)} each</Txt>
        </Card>
      )}

      <View style={s.grid}>
        <Metric label="Leads today" value={d.leads_today} icon="flash-outline" testID="metric-leads-today" accent={colors.brandSecondary} />
        <Metric label="Leads this month" value={d.leads_month} icon="trending-up-outline" testID="metric-leads-month" />
        <Metric label="Units available" value={inv.available} icon="grid-outline" testID="metric-units-available" accent={colors.success} />
        <Metric label="Upcoming visits" value={d.upcoming_visits.length} icon="calendar-outline" testID="metric-upcoming-visits" />
      </View>

      <Row style={{ marginTop: spacing.lg, gap: spacing.sm, flexWrap: "wrap" }}>
        {quick.filter((x) => x.show).map((x) => (
          <Pressy key={x.id} testID={`quick-${x.id}`} onPress={() => router.push(x.to)} style={s.quick}>
            <Icon name={x.icon} size={18} color={colors.onSurface} />
            <Txt variant="bodyStrong">{x.label}</Txt>
          </Pressy>
        ))}
      </Row>

      <Section title="Lead temperature" />
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          {(["Hot", "Warm", "Cold"] as const).map((t) => (
            <View key={t} style={{ flex: 1 }} testID={`tier-${t.toLowerCase()}`}>
              <Txt variant="metric" color={tierColor(colors, t)}>{d.tiers[t]}</Txt>
              <Txt variant="caption">{t}</Txt>
            </View>
          ))}
        </Row>
      </Card>

      <Section title="Inventory" action="Open grid" onAction={() => router.push("/(tabs)/inventory")} testID="open-inventory-link" />
      <Card>
        <Bar parts={(["available", "reserved", "sold", "blocked"] as const).map((k) => ({ v: inv[k], c: statusColor(colors, k) }))} />
        <Row style={{ marginTop: spacing.md, justifyContent: "space-between" }}>
          {(["available", "reserved", "sold", "blocked"] as const).map((k) => (
            <View key={k}>
              <Txt variant="h3">{inv[k]}</Txt>
              <Row style={{ gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor(colors, k) }} /><Txt variant="caption">{k}</Txt></Row>
            </View>
          ))}
        </Row>
      </Card>

      <Section title="Pipeline" action="All leads" onAction={() => router.push("/(tabs)/leads")} testID="open-leads-link" />
      <Card style={{ gap: spacing.md }}>
        {STAGES.map((st) => (
          <View key={st} style={{ gap: 6 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="caption">{STAGE_LABEL[st]}</Txt>
              <Txt variant="bodyStrong">{d.by_stage[st]}</Txt>
            </Row>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary }}>
              <View style={{ width: `${(d.by_stage[st] / maxStage) * 100}%`, height: 6, borderRadius: 3, backgroundColor: st === "closed_won" ? colors.success : st === "closed_lost" ? colors.muted : colors.brandPrimary }} />
            </View>
          </View>
        ))}
      </Card>

      {d.team && (
        <>
          <Section title="Team performance & commissions" />
          <Card style={{ paddingVertical: spacing.sm }} testID="team-performance-card">
            {d.team.map((t: any, i: number) => (
              <Row key={t.id} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Avatar name={t.name} size={36} online={t.online} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{t.name}</Txt>
                  <Txt variant="caption">{t.leads} leads · {t.hot} hot · {t.won} won</Txt>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Txt variant="bodyStrong">{inrFull(t.earnings)}</Txt>
                  <Txt variant="caption">{t.units_sold} sold</Txt>
                </View>
              </Row>
            ))}
          </Card>
        </>
      )}

      {d.source_performance && (
        <>
          <Section title="Marketing source performance" />
          <Card style={{ paddingVertical: spacing.sm }} testID="source-performance-card">
            {d.source_performance.map((x: any, i: number) => (
              <Row key={x.source} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>{sourceLabel(x.source)}</Txt>
                <Txt variant="caption" style={{ width: 64, textAlign: "right" }}>{x.leads} leads</Txt>
                <Txt variant="caption" style={{ width: 64, textAlign: "right" }}>{x.visits} visits</Txt>
                <Txt variant="bodyStrong" style={{ width: 48, textAlign: "right" }} color={colors.success}>{x.won} won</Txt>
              </Row>
            ))}
          </Card>
        </>
      )}

      {d.upcoming_visits.length > 0 && (
        <>
          <Section title="Upcoming site visits" action="View all" onAction={() => router.push("/visits")} />
          {d.upcoming_visits.map((v: any) => (
            <Pressy key={v.id} onPress={() => router.push(`/lead/${v.lead_id}`)} style={[s.visit]} testID={`upcoming-visit-${v.id}`}>
              <Icon name="location-outline" size={18} color={colors.brandSecondary} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{v.lead_name}</Txt>
                <Txt variant="caption">{v.project_name} · {fmtDateTime(v.scheduled_at)}</Txt>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.muted} />
            </Pressy>
          ))}
        </>
      )}

      <Section title="Recent activity" />
      <Card style={{ paddingVertical: spacing.sm }}>
        {d.recent_activity.length === 0 && <Txt variant="caption">No activity yet.</Txt>}
        {d.recent_activity.map((a: any, i: number) => (
          <Pressy key={a.id} onPress={() => router.push(`/lead/${a.lead_id}`)} style={[s.listRow, i > 0 && s.rowBorder]}>
            <View style={{ flex: 1 }}>
              <Txt variant="body" numberOfLines={2}>{a.text}</Txt>
              <Txt variant="caption">{a.user_name} · {timeAgo(a.created_at)}</Txt>
            </View>
          </Pressy>
        ))}
      </Card>
    </>
  );
}

function PartnerHome({ d }: { d: any }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const p = d.partner;
  const approved = p?.status === "approved";
  return (
    <>
      <LinearGradient colors={[colors.surfaceTertiary, colors.surfaceSecondary]} style={s.hero}>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="label">{p?.agency}</Txt>
          <Badge testID="partner-status-badge" label={(p?.status ?? "").toUpperCase()} color={approved ? colors.success : colors.warning} />
        </Row>
        <Txt variant="display" style={{ marginTop: spacing.sm }} testID="partner-earned">{inr(d.commission_totals.paid + d.commission_totals.approved)}</Txt>
        <Txt variant="caption">Commission earned (approved + paid)</Txt>
        {!approved && <Txt variant="body" color={colors.warning} style={{ marginTop: spacing.md }}>Your account is awaiting developer approval. You can register leads once approved.</Txt>}
      </LinearGradient>
      <View style={s.grid}>
        <Metric label="Clients registered" value={d.total_leads} icon="person-add-outline" testID="partner-metric-leads" />
        <Metric label="Bookings won" value={d.by_stage.closed_won} icon="trophy-outline" testID="partner-metric-won" accent={colors.success} />
        <Metric label="Pending payout" value={inr(d.commission_totals.pending + d.commission_totals.approved)} icon="hourglass-outline" testID="partner-metric-pending" />
        <Metric label="Paid out" value={inr(d.commission_totals.paid)} icon="wallet-outline" testID="partner-metric-paid" />
      </View>
      <Btn title="Register a client" icon="add" testID="partner-register-lead-button" disabled={!approved} onPress={() => router.push("/lead/new")} style={{ marginTop: spacing.lg }} />
      <Btn title="My commissions" variant="ghost" icon="cash-outline" testID="partner-commissions-button" onPress={() => router.push("/partners")} style={{ marginTop: spacing.sm }} />
      <Section title="Recently registered" />
      {d.recent_leads.length === 0 && <Txt variant="caption">No clients registered yet.</Txt>}
      {d.recent_leads.map((l: any) => (
        <Pressy key={l.id} onPress={() => router.push(`/lead/${l.id}`)} style={s.visit} testID={`partner-lead-${l.id}`}>
          <Icon name="lock-closed" size={16} color={colors.brandSecondary} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{l.name}</Txt>
            <Txt variant="caption">{l.project_name ?? "—"} · {STAGE_LABEL[l.stage]}</Txt>
          </View>
          <Txt variant="caption">{timeAgo(l.created_at)}</Txt>
        </Pressy>
      ))}
    </>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  hero: { borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: c.border },
  forecast: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: c.border },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.md },
  metric: { width: "47.5%", flexGrow: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  quick: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, height: 44, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  listRow: { paddingVertical: spacing.md, gap: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: c.border },
  visit: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, marginBottom: spacing.sm },
}));
