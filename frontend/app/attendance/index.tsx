import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, fileUrl } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, EmptyState, ErrorState, KV, Row, ScreenHeader, Section, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { LiveCapture } from "@/src/attendance/LiveCapture";
import { ExceptionSheet } from "@/src/attendance/ExceptionSheet";
import { AttKind, fmtDuration, fmtTime, STATUS_LABEL, submitAttendance } from "@/src/attendance/service";

export default function Attendance() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const allowed = !!user && user.role !== "channel_partner" && user.role !== "global_admin";
  const q = useQuery({ enabled: allowed, queryKey: ["attendance", "me"], queryFn: () => api<any>("/attendance/me") });
  const [capture, setCapture] = useState<AttKind | null>(null);
  const [exception, setException] = useState<AttKind | null>(null);

  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }}><ScreenHeader back title="Attendance" /><EmptyState icon="lock-closed-outline" title="Not available" sub="Attendance is for organization employees." testID="attendance-denied" /></View>;
  }
  const d = q.data;
  const rec = d?.record;
  const next: AttKind | null = !rec ? "check_in" : rec.status === "open" ? "check_out" : null;
  const sc = (s: string) => (s === "present" || s === "corrected" ? colors.success : s === "open" ? colors.brandSecondary : s === "incomplete" ? colors.warning : colors.muted);

  const confirm = async (uri: string) => {
    try {
      await submitAttendance(capture!, uri, d.location_enabled);
      toast.show(capture === "check_in" ? "Checked in" : "Checked out");
      setCapture(null);
      q.refetch();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Attendance" subtitle="Live photo check-in & check-out" testID="attendance-header"
        right={user?.role === "org_admin" ? <Btn small title="Dashboard" icon="stats-chart-outline" variant="secondary" testID="attendance-admin-link" onPress={() => router.push("/attendance/admin")} /> : undefined} />
      {q.isLoading ? <SkeletonList n={3} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} />}>
          <Card testID="attendance-today-card">
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="h3">Today · {new Date(d.today).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</Txt>
              <Badge label={(rec ? STATUS_LABEL[rec.status] : "Not checked in").toUpperCase()} color={rec ? sc(rec.status) : colors.muted} testID="attendance-today-status" />
            </Row>
            <KV k="Check in" v={fmtTime(rec?.check_in_at)} testID="attendance-check-in-time" />
            <KV k="Check out" v={fmtTime(rec?.check_out_at)} testID="attendance-check-out-time" />
            <KV k="Worked" v={fmtDuration(rec?.duration_minutes)} />
            {next ? (
              <Btn title={next === "check_in" ? "Check in" : "Check out"} icon="camera" style={{ marginTop: spacing.md }} testID={`attendance-${next}-button`} onPress={() => setCapture(next)} />
            ) : <Txt variant="caption" style={{ marginTop: spacing.md }}>You&apos;re done for today.</Txt>}
            {next && <Btn title="Camera not working?" variant="ghost" small style={{ marginTop: spacing.sm }} testID="attendance-exception-link" onPress={() => setException(next)} />}
          </Card>
          <Txt variant="caption" style={{ marginTop: spacing.sm }}>
            Times are recorded by the server. Photos are private and deleted after {d.retention_days} days.{d.location_enabled ? " Location is added only if you allow it." : ""}
          </Txt>

          {d.exceptions.length > 0 && (
            <>
              <Section title="My requests" />
              <Card>
                {d.exceptions.map((e: any) => (
                  <Row key={e.id} style={{ paddingVertical: 6 }} testID={`attendance-exception-${e.id}`}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="body">{e.kind === "check_in" ? "Check in" : "Check out"} · {new Date(e.requested_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Txt>
                      <Txt variant="caption" numberOfLines={1}>{e.reason}</Txt>
                    </View>
                    <Badge label={e.status.toUpperCase()} color={e.status === "approved" ? colors.success : e.status === "rejected" ? colors.error : colors.warning} />
                  </Row>
                ))}
              </Card>
            </>
          )}

          <Section title="This month" />
          {d.history.length === 0 ? <EmptyState icon="calendar-outline" title="No attendance yet" sub="Your check-ins will appear here." /> : (
            <View style={{ gap: spacing.sm }}>
              {d.history.map((r: any) => (
                <Row key={r.id} testID={`attendance-history-${r.date}`} style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
                  {r.check_in_photo_url ? <Image source={{ uri: fileUrl(r.check_in_photo_url) }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary }} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary }} />}
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{new Date(r.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</Txt>
                    <Txt variant="caption">{fmtTime(r.check_in_at)} – {fmtTime(r.check_out_at)} · {fmtDuration(r.duration_minutes)}</Txt>
                  </View>
                  <Badge label={STATUS_LABEL[r.status].toUpperCase()} color={sc(r.status)} />
                </Row>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      <LiveCapture visible={!!capture} title={capture === "check_out" ? "Check out photo" : "Check in photo"} onCancel={() => setCapture(null)} onConfirm={confirm}
        onUnavailable={() => setException(capture ?? "check_in")} />
      <ExceptionSheet key={exception ?? "none"} visible={!!exception} initialKind={exception ?? "check_in"} onClose={() => setException(null)} onSent={() => q.refetch()} />
    </View>
  );
}
