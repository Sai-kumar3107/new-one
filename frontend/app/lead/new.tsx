import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { sourceLabel, SOURCES } from "@/src/format";
import { useToast } from "@/src/toast";
import { Btn, Chip, Field, Row, ScreenHeader, Txt, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

function ChipScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {children}
    </ScrollView>
  );
}

export default function NewLead() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isCP = user?.role === "channel_partner";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<any[]>("/projects") });
  const [f, setF] = useState({ name: "", phone: "", email: "", location: "", bmin: "", bmax: "" });
  const [source, setSource] = useState("manual");
  const [pid, setPid] = useState<string | null>(null);
  const [bhk, setBhk] = useState<number | null>(null);
  const [facing, setFacing] = useState<string | null>(null);
  const [timeline, setTimeline] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.name.trim() || !f.phone.trim()) return toast.show("Name and mobile are required", "error");
    setBusy(true);
    try {
      const lead = await api("/leads", {
        body: {
          name: f.name.trim(), phone: f.phone, email: f.email, source, project_id: pid, bhk, preferred_facing: facing, timeline, location: f.location,
          budget_min: f.bmin ? Number(f.bmin) * 1e5 : null, budget_max: f.bmax ? Number(f.bmax) * 1e5 : null,
        },
      });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.show(isCP ? "Client registered & locked to you" : `Lead created · assigned to ${lead.assigned_name ?? "team"}`);
      router.replace(`/lead/${lead.id}`);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title={isCP ? "Register client" : "New lead"} subtitle={isCP ? "Ownership locks to your agency for 90 days" : "Auto-scored, auto-assigned, instant WhatsApp"} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Field label="Buyer name *" testID="lead-name-input" value={f.name} onChangeText={set("name")} placeholder="Full name" />
        <Field label="Mobile *" testID="lead-phone-input" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="10-digit mobile" maxLength={14} />
        <Field label="Email" testID="lead-email-input" value={f.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" placeholder="Optional" />
        {!isCP && (
          <View style={{ gap: 6 }}>
            <Txt variant="label">Source</Txt>
            <ChipScroll>
              {SOURCES.map((src) => <Chip key={src} label={sourceLabel(src)} selected={source === src} onPress={() => setSource(src)} testID={`lead-source-${src}`} />)}
            </ChipScroll>
          </View>
        )}
        <View style={{ gap: 6 }}>
          <Txt variant="label">Project interest</Txt>
          <ChipScroll>
            {(projects.data ?? []).map((p) => <Chip key={p.id} label={p.name} selected={pid === p.id} onPress={() => setPid(pid === p.id ? null : p.id)} testID={`lead-project-${p.id}`} />)}
          </ChipScroll>
        </View>
        <Row style={{ gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field label="Budget min (₹ Lakh)" testID="lead-budget-min-input" value={f.bmin} onChangeText={set("bmin")} keyboardType="numeric" placeholder="80" /></View>
          <View style={{ flex: 1 }}><Field label="Budget max (₹ Lakh)" testID="lead-budget-max-input" value={f.bmax} onChangeText={set("bmax")} keyboardType="numeric" placeholder="120" /></View>
        </Row>
        <View style={{ gap: 6 }}>
          <Txt variant="label">Configuration</Txt>
          <ChipScroll>{[1, 2, 3, 4].map((b) => <Chip key={b} label={`${b} BHK`} selected={bhk === b} onPress={() => setBhk(bhk === b ? null : b)} testID={`lead-bhk-${b}`} />)}</ChipScroll>
        </View>
        <View style={{ gap: 6 }}>
          <Txt variant="label">Facing</Txt>
          <ChipScroll>{["North", "East", "South", "West"].map((x) => <Chip key={x} label={x} selected={facing === x} onPress={() => setFacing(facing === x ? null : x)} testID={`lead-facing-${x.toLowerCase()}`} />)}</ChipScroll>
        </View>
        <View style={{ gap: 6 }}>
          <Txt variant="label">Buying timeline</Txt>
          <ChipScroll>{["immediate", "0-3 months", "3-6 months", "6-12 months"].map((x) => <Chip key={x} label={x} selected={timeline === x} onPress={() => setTimeline(x)} testID={`lead-timeline-${x.replace(/ /g, "")}`} />)}</ChipScroll>
        </View>
        <Field label="Preferred location" testID="lead-location-input" value={f.location} onChangeText={set("location")} placeholder="e.g. Whitefield" />
        <Btn title={isCP ? "Register & lock client" : "Create lead"} testID="lead-submit-button" loading={busy} onPress={submit} icon="checkmark" />
      </KeyboardAwareScrollView>
    </View>
  );
}
