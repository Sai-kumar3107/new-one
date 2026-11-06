import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { api, openFile } from "@/src/api";
import { canEditLeads, useAuth } from "@/src/auth";
import { fmtDateTime, inr, inrFull } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, ErrorState, Icon, KV, Pressy, Row, ScreenHeader, Section, Sheet, SkeletonList, statusColor, Txt, centered } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function UnitDetail() {
  const { id, leadId } = useLocalSearchParams<{ id: string; leadId?: string }>();
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canAct = canEditLeads(user?.role);
  const [picker, setPicker] = useState<null | "reserve" | "book">(null);
  const inFlight = useRef(false);

  const q = useQuery({ queryKey: ["unit", id], queryFn: () => api(`/units/${id}`) });
  const leads = useQuery({ enabled: canAct && !!picker, queryKey: ["leads", "all", ""], queryFn: () => api("/leads?stage=all") });

  const act = useMutation({
    mutationFn: ({ action, lead }: { action: string; lead?: string }) => api(`/units/${id}/${action}`, { body: { lead_id: lead ?? null } }),
    onSuccess: (_d, v) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show({ reserve: "Unit reserved for 48 hours", book: "Booking confirmed", release: "Unit released", block: "Unit status updated" }[v.action] ?? "Done");
      setPicker(null);
      ["unit", "units", "projects", "dashboard", "lead", "leads", "recs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.show(e.message, "error");
      qc.invalidateQueries({ queryKey: ["unit", id] });
    },
  });

  if (q.isLoading) return <View style={s.root}><ScreenHeader back title="Unit" /><SkeletonList n={3} h={110} /></View>;
  if (q.isError) return <View style={s.root}><ScreenHeader back title="Unit" /><ErrorState onRetry={() => q.refetch()} /></View>;
  const u: any = q.data;
  const c = statusColor(colors, u.status);

  // Ref lock: two taps in the same tick must not fire two requests (state updates are batched).
  const run = (action: string, lead?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    act.mutate({ action, lead }, { onSettled: () => { inFlight.current = false; } });
  };
  const start = (mode: "reserve" | "book") => {
    if (leadId) run(mode, leadId);
    else setPicker(mode);
  };

  return (
    <View style={s.root}>
      <ScreenHeader back title={`${u.tower}-${u.unit_no}`} subtitle={u.project_name} testID="unit-detail-header" />
      <ScrollView contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        <View style={[s.hero, { borderColor: `${c}66` }]}>
          <View style={[s.bar, { backgroundColor: c }]} />
          <Row style={{ justifyContent: "space-between" }}>
            <Badge testID="unit-status-badge" label={u.status.toUpperCase()} color={c} />
            <Txt variant="caption">Floor {u.floor} · Tower {u.tower}</Txt>
          </Row>
          <Txt variant="display" style={{ marginTop: spacing.md }} testID="unit-price">{inr(u.base_price)}</Txt>
          <Txt variant="caption">{inrFull(u.base_price)} base price · excl. GST & charges</Txt>
          {u.status === "reserved" && u.reserved_until && <Txt variant="bodyStrong" color={colors.warning} style={{ marginTop: spacing.sm }}>Hold expires {fmtDateTime(u.reserved_until)}</Txt>}
        </View>

        <Section title="Specifications" />
        <Card style={{ paddingVertical: spacing.sm }}>
          <KV k="Configuration" v={`${u.bhk} BHK`} />
          <KV k="Carpet area" v={`${u.carpet_area} sq.ft`} />
          <KV k="Facing" v={u.facing} testID="unit-facing" />
          <KV k="Rate" v={`₹${Math.round(u.base_price / u.carpet_area).toLocaleString("en-IN")}/sq.ft`} />
          {u.super_area ? <KV k="Super area" v={`${u.super_area} sq.ft`} /> : null}
          {u.unit_type ? <KV k="Type" v={u.unit_type} /> : null}
          {u.parking ? <KV k="Parking" v={u.parking} /> : null}
        </Card>
        {u.floor_plan_url && <Btn title="View floor plan" variant="ghost" icon="map-outline" testID="unit-view-floor-plan" style={{ marginTop: spacing.md }} onPress={() => openFile(u.floor_plan_url)} />}

        {(u.status === "sold" || u.status === "reserved") && (
          <>
            <Section title="Buyer & executive" />
            {u.can_view_buyer ? (
              <Card style={{ paddingVertical: spacing.sm }} testID="unit-buyer-card">
                <KV k="Buyer" v={u.buyer_name} testID="unit-buyer-name" />
                <KV k="Buyer phone" v={u.buyer_phone} />
                <KV k={u.status === "sold" ? "Closed by" : "Reserved by"} v={u.sold_by_name ?? u.reserved_by_name} testID="unit-closed-by" />
                {u.agreement_value && <KV k="Agreement value" v={inrFull(u.agreement_value)} />}
              </Card>
            ) : (
              <Card testID="unit-buyer-restricted">
                <Row><Icon name="lock-closed" size={16} color={colors.muted} /><Txt variant="caption" style={{ flex: 1 }}>Buyer and closing executive details are restricted to Admin & Finance.</Txt></Row>
              </Card>
            )}
          </>
        )}

        {canAct && (
          <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
            {u.status === "available" && (
              <>
                <Btn title="Reserve for a lead (48h)" icon="time-outline" testID="unit-reserve-button" loading={act.isPending && act.variables?.action === "reserve"} onPress={() => start("reserve")} />
                <Btn title="Book now" variant="light" icon="checkmark-circle-outline" testID="unit-book-button" loading={act.isPending && act.variables?.action === "book"} onPress={() => start("book")} />
              </>
            )}
            {u.status === "reserved" && (
              <>
                <Btn title="Confirm booking" icon="checkmark-circle-outline" testID="unit-confirm-booking-button" loading={act.isPending && act.variables?.action === "book"} onPress={() => run("book")} />
                <Btn title="Release hold" variant="danger" icon="close-circle-outline" testID="unit-release-button" onPress={() => run("release")} />
              </>
            )}
            {user?.role === "org_admin" && (u.status === "available" || u.status === "blocked") && (
              <Btn title={u.status === "blocked" ? "Unblock unit" : "Block unit"} variant="ghost" icon="ban-outline" testID="unit-block-button" onPress={() => run("block")} />
            )}
          </View>
        )}
      </ScrollView>

      <Sheet visible={!!picker} onClose={() => setPicker(null)} title={picker === "book" ? "Book for which buyer?" : "Reserve for which buyer?"} testID="lead-picker-sheet">
        {leads.isLoading && <SkeletonList n={3} h={56} />}
        {((leads.data as any)?.items ?? []).filter((l: any) => !["closed_won", "closed_lost"].includes(l.stage)).map((l: any) => (
          <Pressy key={l.id} testID={`pick-lead-${l.id}`} disabled={act.isPending} onPress={() => run(picker!, l.id)} style={[s.pick, act.isPending && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{l.name}</Txt>
              <Txt variant="caption">{l.bhk ? `${l.bhk}BHK · ` : ""}{l.budget_max ? `≤ ${inr(l.budget_max)}` : "Budget n/a"}</Txt>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressy>
        ))}
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { borderRadius: radius.lg, padding: spacing.xl, backgroundColor: c.surfaceSecondary, borderWidth: 1, overflow: "hidden" },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  pick: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
}));
