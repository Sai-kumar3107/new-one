import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, fileUrl, openFile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ROLE_LABEL } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, Chip, EmptyState, ErrorState, Icon, IconBtn, KV, Pressy, Row, ScreenHeader, Section, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { fmtDuration, fmtTime, STATUS_LABEL, ym, ymd } from "@/src/attendance/service";
import { RecordSheet } from "@/src/attendance/RecordSheet";

const TABS = [["daily", "Daily"], ["monthly", "Monthly"], ["requests", "Requests"], ["settings", "Settings"]] as const;
const STATUS_FILTERS = ["all", "present", "open", "incomplete", "absent", "corrected"];
const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** Organization Admin attendance dashboard. Backend returns 403 for everyone else. */
export default function AttendanceAdmin() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("daily");
  if (user?.role !== "org_admin") {
    return <View style={{ flex: 1, backgroundColor: colors.surface }}><ScreenHeader back title="Attendance dashboard" /><EmptyState icon="lock-closed-outline" title="Admins only" sub="Only organization admins can view team attendance." testID="attendance-admin-denied" /></View>;
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Attendance dashboard" subtitle="Your organization only" testID="attendance-admin-header" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        <Row style={{ gap: spacing.sm, flexWrap: "wrap", marginBottom: spacing.md }}>
          {TABS.map(([k, l]) => <Chip key={k} label={l} selected={tab === k} onPress={() => setTab(k)} testID={`attendance-tab-${k}`} />)}
        </Row>
        {tab === "daily" && <Daily />}
        {tab === "monthly" && <Monthly />}
        {tab === "requests" && <Requests />}
        {tab === "settings" && <Settings />}
      </KeyboardAwareScrollView>
    </View>
  );
}

function useStatusColor() {
  const { colors } = useTheme();
  return (s: string) => (s === "present" || s === "corrected" ? colors.success : s === "open" ? colors.brandSecondary : s === "incomplete" ? colors.warning : s === "absent" ? colors.error : colors.muted);
}

function Daily() {
  const { colors } = useTheme();
  const sc = useStatusColor();
  const [day, setDay] = useState(new Date());
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["attendance", "daily", ymd(day)], queryFn: () => api<any>(`/attendance/daily?day=${ymd(day)}`) });
  const rows = (q.data?.rows ?? []).filter((r: any) => filter === "all" || r.status === filter);
  const isToday = ymd(day) === q.data?.today;
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <IconBtn icon="chevron-back" testID="daily-prev" onPress={() => setDay(shift(day, -1))} />
        <Txt variant="h3" testID="daily-date">{day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</Txt>
        <IconBtn icon="chevron-forward" testID="daily-next" onPress={() => !isToday && setDay(shift(day, 1))} />
      </Row>
      {q.data?.pending_exceptions > 0 && <Badge label={`${q.data.pending_exceptions} PENDING REQUEST${q.data.pending_exceptions > 1 ? "S" : ""}`} color={colors.warning} testID="daily-pending-badge" />}
      <Row style={{ gap: spacing.sm, flexWrap: "wrap", marginVertical: spacing.md }}>
        {STATUS_FILTERS.map((s) => (
          <Chip key={s} label={`${s === "all" ? "All" : STATUS_LABEL[s]}${s !== "all" && q.data?.counts?.[s] ? ` · ${q.data.counts[s]}` : ""}`} selected={filter === s}
            dot={s === "all" ? undefined : sc(s)} onPress={() => setFilter(s)} testID={`daily-filter-${s}`} />
        ))}
      </Row>
      {q.isLoading ? <SkeletonList n={4} h={60} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState icon="people-outline" title="Nobody here" sub="No employees match this filter." /> : (
        <View style={{ gap: spacing.sm }}>
          {rows.map((r: any) => (
            <Pressy key={r.user.id} disabled={!r.record} onPress={() => setOpen(r.record.id)} testID={`daily-row-${r.user.id}`}>
              <Row style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
                {r.record?.check_in_photo_url ? <Image source={{ uri: fileUrl(r.record.check_in_photo_url) }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary }} />
                  : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}><Icon name="person-outline" size={20} color={colors.muted} /></View>}
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{r.user.name}</Txt>
                  <Txt variant="caption">{ROLE_LABEL[r.user.role]} · {r.record ? `${fmtTime(r.record.check_in_at)} – ${fmtTime(r.record.check_out_at)} · ${fmtDuration(r.record.duration_minutes)}` : "No record"}</Txt>
                </View>
                <Badge label={STATUS_LABEL[r.status].toUpperCase()} color={sc(r.status)} />
              </Row>
            </Pressy>
          ))}
        </View>
      )}
      <RecordSheet recordId={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function Monthly() {
  const { colors } = useTheme();
  const toast = useToast();
  const [m, setM] = useState(new Date());
  const month = ym(m);
  const q = useQuery({ queryKey: ["attendance", "monthly", month], queryFn: () => api<any>(`/attendance/monthly?month=${month}`) });
  const exportCsv = async () => {
    try { openFile((await api(`/attendance/export-link?month=${month}`, { body: {} })).url); } catch (e: any) { toast.show(e.message, "error"); }
  };
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <IconBtn icon="chevron-back" testID="monthly-prev" onPress={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))} />
        <Txt variant="h3" testID="monthly-label">{m.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Txt>
        <IconBtn icon="chevron-forward" testID="monthly-next" onPress={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))} />
      </Row>
      <Btn small title="Export CSV report" icon="download-outline" variant="secondary" style={{ marginVertical: spacing.md, alignSelf: "flex-start" }} testID="monthly-export" onPress={exportCsv} />
      {q.isLoading ? <SkeletonList n={4} h={60} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <View style={{ gap: spacing.sm }}>
          {q.data.rows.map((r: any) => (
            <Card key={r.user_id} testID={`monthly-row-${r.user_id}`}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt variant="bodyStrong">{r.name}</Txt>
                <Txt variant="caption">{ROLE_LABEL[r.role]}</Txt>
              </Row>
              <Row style={{ gap: spacing.lg, marginTop: 6 }}>
                <Txt variant="caption" color={colors.success}>Present {r.present}</Txt>
                <Txt variant="caption" color={colors.warning}>Incomplete {r.incomplete}</Txt>
                <Txt variant="caption" color={colors.error}>Absent {r.absent}</Txt>
                <Txt variant="caption" style={{ marginLeft: "auto" }}>{fmtDuration(r.total_minutes)}</Txt>
              </Row>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

function Requests() {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const q = useQuery({ queryKey: ["attendance", "exceptions", status], queryFn: () => api<any[]>(`/attendance/exceptions?status=${status}`) });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api(`/attendance/exceptions/${id}/decide`, { body: { approve } }),
    onSuccess: (_d, v) => { toast.show(v.approve ? "Approved — attendance recorded" : "Request rejected"); qc.invalidateQueries({ queryKey: ["attendance"] }); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  return (
    <View>
      <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
        {(["pending", "approved", "rejected"] as const).map((s) => <Chip key={s} label={s[0].toUpperCase() + s.slice(1)} selected={status === s} onPress={() => setStatus(s)} testID={`requests-filter-${s}`} />)}
      </Row>
      {q.isLoading ? <SkeletonList n={3} h={80} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? <EmptyState icon="checkmark-done-outline" title="No requests" sub="Camera exception requests from employees appear here." testID="requests-empty" /> : (
        <View style={{ gap: spacing.sm }}>
          {q.data!.map((e) => (
            <Card key={e.id} testID={`request-${e.id}`}>
              <Txt variant="bodyStrong">{e.user_name} · {e.kind === "check_in" ? "Check in" : "Check out"}</Txt>
              <Txt variant="caption">{new Date(e.requested_at).toLocaleString("en-IN")}</Txt>
              <Txt variant="body" style={{ marginTop: 6 }}>{e.reason}</Txt>
              {e.status === "pending" ? (
                <Row style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  <Btn small title="Approve" icon="checkmark" testID={`request-approve-${e.id}`} loading={decide.isPending} onPress={() => decide.mutate({ id: e.id, approve: true })} />
                  <Btn small title="Reject" variant="danger" icon="close" testID={`request-reject-${e.id}`} loading={decide.isPending} onPress={() => decide.mutate({ id: e.id, approve: false })} />
                </Row>
              ) : <Badge label={e.status.toUpperCase()} color={e.status === "approved" ? colors.success : colors.error} />}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

function Settings() {
  const toast = useToast();
  const q = useQuery({ queryKey: ["attendance", "settings"], queryFn: () => api<any>("/attendance/settings") });
  const save = useMutation({
    mutationFn: (body: any) => api("/attendance/settings", { method: "PATCH", body }),
    onSuccess: () => { toast.show("Settings saved"); q.refetch(); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  if (q.isLoading) return <SkeletonList n={2} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <View style={{ gap: spacing.md }}>
      <Section title="Location" />
      <Card>
        <Txt variant="body">Record location with check-ins. Employees are asked first and can decline.</Txt>
        <Row style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Chip label="Off" selected={!s.location_enabled} onPress={() => save.mutate({ location_enabled: false })} testID="settings-location-off" />
          <Chip label="On" selected={s.location_enabled} onPress={() => save.mutate({ location_enabled: true })} testID="settings-location-on" />
        </Row>
      </Card>
      <Section title="Photo retention" />
      <Card>
        <Txt variant="body">Attendance photos are deleted automatically after this many days. Records and times are kept.</Txt>
        <Row style={{ gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" }}>
          {[30, 90, 180, 365].map((d) => <Chip key={d} label={`${d} days`} selected={s.retention_days === d} onPress={() => save.mutate({ retention_days: d })} testID={`settings-retention-${d}`} />)}
        </Row>
      </Card>
      <KV k="Timezone" v={s.timezone} />
    </View>
  );
}
