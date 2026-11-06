import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { inr, inrFull, timeAgo } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, Chip, ChipRow, EmptyState, ErrorState, Field, Icon, KV, Row, ScreenHeader, Sheet, SkeletonList, Txt, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function Partners() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isCP = user?.role === "channel_partner";
  const [tab, setTab] = useState<"partners" | "commissions">(isCP ? "commissions" : "partners");
  const [edit, setEdit] = useState<any>(null);
  const [rule, setRule] = useState({ type: "percent", value: "" });

  const partners = useQuery({ enabled: !isCP, queryKey: ["partners"], queryFn: () => api<any[]>("/partners") });
  const comms = useQuery({ queryKey: ["commissions"], queryFn: () => api("/commissions") });
  const m = useMutation({
    mutationFn: ({ path, body }: { path: string; body: any }) => api(path, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      toast.show("Updated");
    },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  const statusC = (st: string) => (st === "approved" || st === "paid" ? colors.success : st === "pending" ? colors.warning : st === "rejected" || st === "suspended" ? colors.error : colors.brandSecondary);
  const ctotals = (comms.data as any)?.totals;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title={isCP ? "My commissions" : "Channel partners"} subtitle={isCP ? "Payouts from your bookings" : "Brokers, payout slabs & commissions"} />
      {!isCP && (
        <ChipRow>
          <Chip label="Partners" selected={tab === "partners"} onPress={() => setTab("partners")} testID="partners-tab" />
          <Chip label="Commissions" selected={tab === "commissions"} onPress={() => setTab("commissions")} testID="commissions-tab" />
        </ChipRow>
      )}
      <ScrollView
        contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl tintColor={colors.muted} refreshing={partners.isRefetching || comms.isRefetching} onRefresh={() => { partners.refetch(); comms.refetch(); }} />}
      >
        {tab === "partners" ? (
          partners.isLoading ? <SkeletonList n={3} h={160} /> : partners.isError ? <ErrorState onRetry={() => partners.refetch()} /> : partners.data?.length === 0 ? <EmptyState title="No partners yet" sub="Share your org code so brokers can join." /> :
          partners.data!.map((p) => (
            <Card key={p.id} testID={`partner-card-${p.id}`}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3">{p.agency}</Txt>
                  <Txt variant="caption">{p.name} · {p.phone || p.email}</Txt>
                </View>
                <Badge label={p.status.toUpperCase()} color={statusC(p.status)} testID={`partner-status-${p.id}`} />
              </Row>
              <Row style={{ marginTop: spacing.md, gap: spacing.xl }}>
                <View><Txt variant="h2">{p.leads}</Txt><Txt variant="caption">leads</Txt></View>
                <View><Txt variant="h2" color={colors.success}>{p.won}</Txt><Txt variant="caption">won</Txt></View>
                <View><Txt variant="h2">{p.commission_type === "percent" ? `${p.commission_value}%` : inr(p.commission_value)}</Txt><Txt variant="caption">payout slab</Txt></View>
              </Row>
              <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <Row><Icon name="shield-checkmark" size={14} color={colors.brandTertiary} /><Txt variant="label" color={colors.brandTertiary}>Admin / finance only</Txt></Row>
                <KV k="PAN" v={p.pan || "Not submitted"} />
                <KV k="GSTIN" v={p.gst || "Not submitted"} />
                <KV k="Bank" v={p.bank || "Not submitted"} />
                <KV k="RERA" v={p.rera_id || "—"} />
              </View>
              <Row style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {user?.role === "org_admin" && p.status === "pending" && (
                  <>
                    <Btn small title="Approve" icon="checkmark" testID={`partner-approve-${p.id}`} onPress={() => m.mutate({ path: `/partners/${p.id}`, body: { status: "approved" } })} style={{ flex: 1 }} />
                    <Btn small variant="danger" title="Reject" testID={`partner-reject-${p.id}`} onPress={() => m.mutate({ path: `/partners/${p.id}`, body: { status: "rejected" } })} style={{ flex: 1 }} />
                  </>
                )}
                <Btn small variant="ghost" title="Edit slab" icon="create-outline" testID={`partner-edit-slab-${p.id}`} onPress={() => { setEdit(p); setRule({ type: p.commission_type, value: String(p.commission_value) }); }} style={{ flex: 1 }} />
              </Row>
            </Card>
          ))
        ) : comms.isLoading ? (
          <SkeletonList n={3} h={110} />
        ) : comms.isError ? (
          <ErrorState onRetry={() => comms.refetch()} />
        ) : (
          <>
            <Row style={{ gap: spacing.sm }} testID="commission-totals">
              {(["pending", "approved", "paid"] as const).map((k) => (
                <Card key={k} style={{ flex: 1, padding: spacing.md }}>
                  <Txt variant="h3" color={statusC(k)}>{inr(ctotals[k])}</Txt>
                  <Txt variant="caption">{k}</Txt>
                </Card>
              ))}
            </Row>
            {(comms.data as any).items.length === 0 && <EmptyState icon="cash-outline" title="No commissions yet" sub="Commissions are calculated automatically when a partner's client books a unit." />}
            {(comms.data as any).items.map((c: any) => (
              <Card key={c.id} testID={`commission-card-${c.id}`}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{inrFull(c.amount)}</Txt>
                    <Txt variant="caption">{c.lead_name} · {c.unit_label} · {c.milestone}</Txt>
                    {!isCP && <Txt variant="caption">{c.agency} · on {inr(c.agreement_value)}</Txt>}
                  </View>
                  <Badge label={c.status.toUpperCase()} color={statusC(c.status)} testID={`commission-status-${c.id}`} />
                </Row>
                <Txt variant="caption" style={{ marginTop: spacing.xs }}>{timeAgo(c.created_at)}</Txt>
                {!isCP && c.status !== "paid" && c.status !== "rejected" && (
                  <Row style={{ marginTop: spacing.md, gap: spacing.sm }}>
                    {c.status === "pending" && <Btn small title="Approve" testID={`commission-approve-${c.id}`} onPress={() => m.mutate({ path: `/commissions/${c.id}`, body: { status: "approved" } })} style={{ flex: 1 }} />}
                    {c.status === "approved" && <Btn small title="Mark paid" icon="wallet-outline" testID={`commission-pay-${c.id}`} onPress={() => m.mutate({ path: `/commissions/${c.id}`, body: { status: "paid" } })} style={{ flex: 1 }} />}
                  </Row>
                )}
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={`Payout slab · ${edit?.agency ?? ""}`} testID="slab-sheet">
        <Row>
          <Chip label="% of agreement" selected={rule.type === "percent"} onPress={() => setRule((r) => ({ ...r, type: "percent" }))} testID="slab-type-percent" />
          <Chip label="Flat per unit" selected={rule.type === "flat"} onPress={() => setRule((r) => ({ ...r, type: "flat" }))} testID="slab-type-flat" />
        </Row>
        <Field label={rule.type === "percent" ? "Percentage" : "Amount (₹)"} testID="slab-value-input" keyboardType="numeric" value={rule.value} onChangeText={(v) => setRule((r) => ({ ...r, value: v }))} />
        <Btn title="Save slab" testID="slab-save-button" loading={m.isPending} onPress={() => m.mutate({ path: `/partners/${edit.id}`, body: { commission_type: rule.type, commission_value: Number(rule.value) } }, { onSuccess: () => setEdit(null) })} />
      </Sheet>
    </View>
  );
}
