import { useState } from "react";
import { Linking, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { canEditLeads, useAuth } from "@/src/auth";
import { fmtDateTime, inr, sourceLabel, STAGE_LABEL, STAGES, timeAgo } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, Chip, DemoTag, ErrorState, Icon, IconName, KV, Pressy, Row, ScreenHeader, Section, Sheet, SkeletonList, statusColor, tierColor, Txt, centered } from "@/src/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const ACT_ICON: Record<string, IconName> = {
  created: "sparkles-outline", assignment: "swap-horizontal", whatsapp: "logo-whatsapp", call: "call-outline", note: "document-text-outline",
  stage: "git-commit-outline", voice_call: "mic-outline", callback: "alarm-outline", site_visit: "location-outline", booking: "trophy-outline",
  inventory: "cube-outline", ai: "sparkles", lock: "lock-closed-outline", email: "mail-outline",
};

function slot(kind: string): string {
  const d = new Date();
  if (kind === "1h") d.setHours(d.getHours() + 1);
  else if (kind === "today5") d.setHours(17, 0, 0, 0);
  else {
    const map: Record<string, [number, number]> = { tom10: [1, 10], tom18: [1, 18], sat11: [(6 - d.getDay() + 7) % 7 || 7, 11], sun11: [(7 - d.getDay()) % 7 || 7, 11] };
    const [add, h] = map[kind];
    d.setDate(d.getDate() + add);
    d.setHours(h, 0, 0, 0);
  }
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const editable = canEditLeads(user?.role);
  const internal = user?.role !== "channel_partner";
  const [sheet, setSheet] = useState<null | "note" | "visit" | "callback">(null);
  const [noteType, setNoteType] = useState<"note" | "call">("note");
  const [noteText, setNoteText] = useState("");
  const [disp, setDisp] = useState("");
  const [visitProject, setVisitProject] = useState<string | null>(null);
  const [visitSlot, setVisitSlot] = useState("tom10");
  const [cbSlot, setCbSlot] = useState("1h");

  const q = useQuery({ queryKey: ["lead", id], queryFn: () => api(`/leads/${id}`) });
  const recs = useQuery({ enabled: internal, queryKey: ["recs", id], queryFn: () => api<any[]>(`/leads/${id}/recommendations`) });
  const projects = useQuery({ enabled: editable, queryKey: ["projects"], queryFn: () => api<any[]>("/projects") });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["recs", id] });
  };
  const run = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: any; method?: string }) => api(path, { body, method }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.show(e.message, "error"),
  });

  if (q.isLoading) return <View style={s.root}><ScreenHeader back title="Lead" /><SkeletonList n={4} h={120} /></View>;
  if (q.isError) return <View style={s.root}><ScreenHeader back title="Lead" /><ErrorState onRetry={() => q.refetch()} /></View>;
  const { lead, activities, visits, units } = q.data as any;

  const call = () => {
    Linking.openURL(`tel:${lead.phone}`).catch(() => {});
    if (editable) run.mutate({ path: `/leads/${id}/activities`, body: { type: "call", text: "Outbound call via click-to-call", disposition: "Connected" } });
  };
  const whatsapp = () => {
    Linking.openURL(`https://wa.me/91${lead.phone}`).catch(() => {});
    if (editable) run.mutate({ path: `/leads/${id}/activities`, body: { type: "whatsapp", text: "Opened WhatsApp chat" } });
  };

  return (
    <View style={s.root}>
      <ScreenHeader back title={lead.name} subtitle={`${lead.project_name ?? "No project"} · ${sourceLabel(lead.source)}`} testID="lead-detail-header" />
      <ScrollView
        contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
      >
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Txt variant="caption">+91 {lead.phone}</Txt>
              <Txt variant="bodyStrong" style={{ marginTop: 2 }}>{lead.assigned_name ? `Owner · ${lead.assigned_name}` : "Unassigned"}</Txt>
            </View>
            <Badge testID="lead-stage-badge" label={STAGE_LABEL[lead.stage]} color={lead.stage === "closed_won" ? colors.success : lead.stage === "closed_lost" ? colors.muted : colors.brandSecondary} />
          </Row>
          {lead.locked && (
            <Row style={[s.lock]} testID="lead-lock-banner">
              <Icon name="lock-closed" size={14} color={colors.brandSecondary} />
              <Txt variant="caption" color={colors.onSurfaceTertiary}>Locked to {lead.cp_name} until {fmtDateTime(lead.lock_expires_at) || "ownership expiry"}</Txt>
            </Row>
          )}
          {internal && (
            <Row style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Btn small title="Call" icon="call" onPress={call} testID="lead-call-button" style={{ flex: 1 }} />
              <Btn small variant="secondary" title="WhatsApp" icon="logo-whatsapp" onPress={whatsapp} testID="lead-whatsapp-button" style={{ flex: 1 }} />
              {editable && <Btn small variant="secondary" title="Note" icon="create-outline" onPress={() => setSheet("note")} testID="lead-note-button" style={{ flex: 1 }} />}
            </Row>
          )}
        </Card>

        {internal && (
          <>
            <Section title="AI lead score" />
            <Card testID="ai-score-card">
              <Row style={{ alignItems: "flex-end", gap: spacing.md }}>
                <Txt variant="display" color={tierColor(colors, lead.tier)} testID="lead-score-value">{lead.score}</Txt>
                <View style={{ flex: 1, paddingBottom: 4 }}>
                  <Txt variant="h3" color={tierColor(colors, lead.tier)} testID="lead-tier-value">{lead.tier} lead</Txt>
                  <Txt variant="caption">{lead.score_source === "ai" ? `AI model · ${Math.round((lead.score_confidence ?? 0.7) * 100)}% confidence` : "Rules engine"} {lead.scored_at ? `· ${timeAgo(lead.scored_at)}` : ""}</Txt>
                </View>
              </Row>
              <View style={{ marginTop: spacing.md, gap: 6 }}>
                {(lead.score_factors ?? []).map((f: string, i: number) => (
                  <Row key={i} style={{ alignItems: "flex-start" }}>
                    <Icon name="ellipse" size={6} color={colors.muted} style={{ marginTop: 7 }} />
                    <Txt variant="body" style={{ flex: 1 }}>{f}</Txt>
                  </Row>
                ))}
              </View>
              {!!lead.next_action && (
                <View style={s.nextAction}>
                  <Icon name="sparkles" size={16} color={colors.brandTertiary} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }} testID="lead-next-action">{lead.next_action}</Txt>
                </View>
              )}
              <Btn small variant="ghost" title="Rescore with AI" icon="sparkles-outline" loading={run.isPending && run.variables?.path.endsWith("/score")} onPress={() => run.mutate({ path: `/leads/${id}/score`, body: {} }, { onSuccess: () => toast.show("AI score updated") })} testID="lead-rescore-button" style={{ marginTop: spacing.md }} />
            </Card>
          </>
        )}

        {editable && (
          <>
            <Section title="Instant engagement" />
            <Card testID="engagement-card">
              <Row style={{ justifyContent: "space-between" }}>
                <Txt variant="bodyStrong">WhatsApp trigger · 24/7</Txt>
                <DemoTag />
              </Row>
              <Txt variant="caption" style={{ marginTop: spacing.sm }}>“Thanks for your interest! When would you like us to contact you?” Simulate the buyer&apos;s reply:</Txt>
              <Row style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <Btn small title="Now → AI call" icon="mic" onPress={() => run.mutate({ path: `/leads/${id}/engage`, body: { choice: "now" } }, { onSuccess: () => toast.show("AI voice agent qualified the lead") })} loading={run.isPending && run.variables?.body?.choice === "now"} testID="engage-now-button" style={{ flex: 1 }} />
                <Btn small variant="secondary" title="Choose time" icon="alarm-outline" onPress={() => setSheet("callback")} testID="engage-schedule-button" style={{ flex: 1 }} />
              </Row>
              {lead.qualified && <Txt variant="caption" color={colors.success} style={{ marginTop: spacing.sm }}>✓ Qualified by AI voice agent</Txt>}
              {lead.callback_at && <Txt variant="caption" style={{ marginTop: spacing.sm }}>Callback scheduled {fmtDateTime(lead.callback_at)}</Txt>}
            </Card>

            <Section title="Pipeline stage" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} testID="lead-stage-selector">
              {STAGES.map((st) => (
                <Chip key={st} label={STAGE_LABEL[st]} selected={lead.stage === st} onPress={() => st !== lead.stage && run.mutate({ path: `/leads/${id}`, body: { stage: st }, method: "PATCH" }, { onSuccess: () => toast.show(`Moved to ${STAGE_LABEL[st]}`) })} testID={`set-stage-${st}`} />
              ))}
            </ScrollView>
          </>
        )}

        <Section title="Requirements" />
        <Card style={{ paddingVertical: spacing.sm }}>
          <KV k="Budget" v={lead.budget_max ? `${inr(lead.budget_min)} – ${inr(lead.budget_max)}` : "—"} testID="lead-budget" />
          <KV k="Configuration" v={lead.bhk ? `${lead.bhk} BHK` : "—"} />
          <KV k="Facing" v={lead.preferred_facing} />
          <KV k="Location" v={lead.location || "—"} />
          <KV k="Timeline" v={lead.timeline || "—"} />
        </Card>

        {internal && (
          <>
            <Section title="AI property matches" />
            {recs.isLoading && <SkeletonList n={2} h={64} />}
            {recs.data?.length === 0 && <Txt variant="caption">No available units match this buyer yet — they&apos;ll get a future property alert.</Txt>}
            {recs.data?.map((u: any) => (
              <Pressy key={u.id} testID={`rec-unit-${u.id}`} onPress={() => router.push({ pathname: "/unit/[id]", params: { id: u.id, leadId: id } })} style={s.rec}>
                <View style={[s.match]}><Txt variant="bodyStrong" color={colors.onBrandPrimary}>{u.match}%</Txt></View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{u.project_name} · {u.tower}-{u.unit_no}</Txt>
                  <Txt variant="caption" numberOfLines={1}>{u.bhk}BHK · {u.facing} · {u.carpet_area} sqft · {inr(u.base_price)}</Txt>
                  <Txt variant="caption" color={colors.brandSecondary} numberOfLines={1}>{u.reasons.join(" · ")}</Txt>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Pressy>
            ))}
          </>
        )}

        {units.length > 0 && (
          <>
            <Section title="Units held" />
            {units.map((u: any) => (
              <Pressy key={u.id} onPress={() => router.push({ pathname: "/unit/[id]", params: { id: u.id, leadId: id } })} style={s.rec} testID={`held-unit-${u.id}`}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(colors, u.status) }} />
                <Txt variant="bodyStrong" style={{ flex: 1 }}>{u.tower}-{u.unit_no} · {u.bhk}BHK · {inr(u.base_price)}</Txt>
                <Txt variant="caption">{u.status}</Txt>
              </Pressy>
            ))}
          </>
        )}

        <Section title="Site visits" action={editable ? "Schedule" : undefined} onAction={() => setSheet("visit")} testID="schedule-visit-link" />
        {visits.length === 0 && <Txt variant="caption">No site visits yet.</Txt>}
        {visits.map((v: any) => (
          <Row key={v.id} style={s.rec}>
            <Icon name="location-outline" size={18} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{v.project_name}</Txt>
              <Txt variant="caption">{fmtDateTime(v.scheduled_at)} · {v.status}</Txt>
            </View>
          </Row>
        ))}

        <Section title="Activity timeline" />
        <View testID="lead-timeline">
          {activities.map((a: any, i: number) => (
            <Row key={a.id} style={{ alignItems: "flex-start", gap: spacing.md }}>
              <View style={{ alignItems: "center" }}>
                <View style={s.tlIcon}><Icon name={ACT_ICON[a.type] ?? "ellipse-outline"} size={14} color={a.type === "ai" || a.type === "voice_call" ? colors.brandTertiary : colors.onSurface} /></View>
                {i < activities.length - 1 && <View style={s.tlLine} />}
              </View>
              <View style={{ flex: 1, paddingBottom: spacing.lg }}>
                <Txt variant="body">{a.text}</Txt>
                <Txt variant="caption">{a.user_name} · {timeAgo(a.created_at)}</Txt>
              </View>
            </Row>
          ))}
        </View>
      </ScrollView>

      <Sheet visible={sheet === "note"} onClose={() => setSheet(null)} title="Log activity" testID="note-sheet">
        <Row>
          <Chip label="Note" selected={noteType === "note"} onPress={() => setNoteType("note")} testID="note-type-note" />
          <Chip label="Call" selected={noteType === "call"} onPress={() => setNoteType("call")} testID="note-type-call" />
        </Row>
        {noteType === "call" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {["Interested", "Call back later", "Not reachable", "Not interested"].map((d) => (
              <Chip key={d} label={d} selected={disp === d} onPress={() => setDisp(d)} testID={`disposition-${d.toLowerCase().replace(/ /g, "-")}`} />
            ))}
          </ScrollView>
        )}
        <TextInput testID="note-text-input" value={noteText} onChangeText={setNoteText} placeholder="What happened?" placeholderTextColor={colors.muted} multiline style={s.textArea} />
        <Btn title="Save" testID="note-save-button" loading={run.isPending} onPress={() => run.mutate({ path: `/leads/${id}/activities`, body: { type: noteType, text: noteText, disposition: disp } }, { onSuccess: () => { setSheet(null); setNoteText(""); setDisp(""); toast.show("Activity logged"); } })} />
      </Sheet>

      <Sheet visible={sheet === "visit"} onClose={() => setSheet(null)} title="Schedule site visit" testID="visit-sheet">
        <Txt variant="label">Project</Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {(projects.data ?? []).filter((p) => p.status === "active").map((p) => (
            <Chip key={p.id} label={p.name} selected={(visitProject ?? lead.project_id) === p.id} onPress={() => setVisitProject(p.id)} testID={`visit-project-${p.id}`} />
          ))}
        </ScrollView>
        <Txt variant="label">When</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {[["today5", "Today 5 PM"], ["tom10", "Tomorrow 10 AM"], ["tom18", "Tomorrow 6 PM"], ["sat11", "Saturday 11 AM"], ["sun11", "Sunday 11 AM"]].map(([k, l]) => (
            <Chip key={k} label={l} selected={visitSlot === k} onPress={() => setVisitSlot(k)} testID={`visit-slot-${k}`} />
          ))}
        </View>
        <Txt variant="caption">Buyer receives a WhatsApp confirmation with a Google Maps pin (demo).</Txt>
        <Btn title="Confirm visit" testID="visit-confirm-button" loading={run.isPending} onPress={() => run.mutate({ path: "/site-visits", body: { lead_id: id, project_id: visitProject ?? lead.project_id, scheduled_at: slot(visitSlot) } }, { onSuccess: () => { setSheet(null); toast.show("Site visit scheduled"); } })} />
      </Sheet>

      <Sheet visible={sheet === "callback"} onClose={() => setSheet(null)} title="Buyer picks a callback time" testID="callback-sheet">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {[["1h", "In 1 hour"], ["today5", "Today 5 PM"], ["tom10", "Tomorrow 10 AM"], ["tom18", "Tomorrow 6 PM"]].map(([k, l]) => (
            <Chip key={k} label={l} selected={cbSlot === k} onPress={() => setCbSlot(k)} testID={`callback-slot-${k}`} />
          ))}
        </View>
        <Btn title="Schedule AI callback" testID="callback-confirm-button" loading={run.isPending} onPress={() => run.mutate({ path: `/leads/${id}/engage`, body: { choice: "schedule", callback_at: slot(cbSlot) } }, { onSuccess: () => { setSheet(null); toast.show("Callback scheduled"); } })} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  lock: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary },
  nextAction: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  rec: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, marginBottom: spacing.sm },
  match: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  tlIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tlLine: { width: 1, flex: 1, backgroundColor: c.border, marginVertical: 2 },
  textArea: { minHeight: 100, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, color: c.onSurface, padding: spacing.lg, fontFamily: fonts.medium, fontSize: 15, textAlignVertical: "top" },
}));
