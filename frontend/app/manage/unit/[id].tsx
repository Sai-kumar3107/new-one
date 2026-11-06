import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, apiUpload, fileUrl, openFile } from "@/src/api";
import { inrFull } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, ErrorState, Field, Icon, Row, ScreenHeader, Section, SkeletonList, Txt, centered, statusColor, useLayout } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { ChipPick } from "@/src/manage/ChipPick";
import { confirmAsk, FACINGS, str, UNIT_TYPES } from "@/src/manage/helpers";

const NUMS = ["floor", "bhk", "carpet_area", "super_area", "base_price"] as const;

export default function ManageUnit() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  const isNew = id === "new";
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { wide } = useLayout();
  const q = useQuery({ enabled: !isNew, queryKey: ["unit", id], queryFn: () => api(`/units/${id}`) });
  const assets = useQuery({ enabled: !isNew, queryKey: ["unit-assets", id], queryFn: () => api<any[]>(`/units/${id}/assets`) });
  const u: any = q.data;
  const [f, setF] = useState<Record<string, string>>({ tower: "", unit_no: "", floor: "", bhk: "", carpet_area: "", super_area: "", base_price: "", parking: "", notes: "" });
  const [facing, setFacing] = useState<string | null>("North");
  const [utype, setUtype] = useState<string | null>("apartment");
  const [status, setStatus] = useState<string | null>("available");
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!u) return;
    setF(Object.fromEntries(["tower", "unit_no", "parking", "notes", ...NUMS].map((k) => [k, str(u[k])])));
    setFacing(u.facing); setUtype(u.unit_type ?? "apartment"); setStatus(u.status);
  }, [u?.id, u?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = u && (u.status === "reserved" || u.status === "sold");
  const pid = isNew ? projectId : u?.project_id;
  const refresh = () => ["unit", "units", "projects", "project", "unit-assets"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = async () => {
    if (!f.tower.trim() || !f.unit_no.trim()) return toast.show("Tower and unit number are required", "error");
    for (const k of ["floor", "bhk", "carpet_area", "base_price"]) if (!f[k].trim() || Number.isNaN(Number(f[k]))) return toast.show(`${k.replace("_", " ")} must be a number`, "error");
    if (f.super_area.trim() && Number.isNaN(Number(f.super_area))) return toast.show("Super area must be a number", "error");
    const body: any = { tower: f.tower.trim(), unit_no: f.unit_no.trim(), parking: f.parking, notes: f.notes, facing, unit_type: utype,
      ...Object.fromEntries(NUMS.map((k) => [k, f[k].trim() ? Math.round(Number(f[k])) : null])) };
    if (!locked) body.status = status;
    if (locked) {
      const ok = await confirmAsk(`This unit is ${u.status}`, `Changes affect a unit that is ${u.status} to ${u.buyer_name ?? "a buyer"}. Price changes do not alter the agreed deal value. Continue?`, "Save changes");
      if (!ok) return;
      body.confirm = true;
    }
    setBusy("save");
    try {
      const saved = isNew ? await api(`/projects/${projectId}/units`, { body }) : await api(`/units/${id}`, { method: "PATCH", body });
      refresh();
      toast.show(isNew ? "Unit added" : "Unit saved");
      if (isNew) router.replace(`/manage/unit/${saved.id}`);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirmAsk("Delete unit?", `${u.tower}-${u.unit_no} will be permanently removed from inventory.`, "Delete", true))) return;
    setBusy("delete");
    try {
      await api(`/units/${id}`, { method: "DELETE" });
      refresh();
      toast.show("Unit deleted");
      if (router.canGoBack()) router.back();
      else router.replace(`/manage/project/${u.project_id}`);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const uploadPlan = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp", "application/pdf"], copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    setBusy("plan");
    try {
      await apiUpload(`/projects/${pid}/assets`, { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined }, { kind: "floor_plan", unit_id: id });
      refresh();
      toast.show("Floor plan uploaded");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const plan = (assets.data ?? []).find((a) => a.id === u?.floor_plan_asset_id);
  const pair = (a: React.ReactNode, b: React.ReactNode) => (
    <Row style={{ gap: spacing.md, alignItems: "flex-start", flexDirection: wide ? "row" : "column" }}>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : "100%" }}>{a}</View>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : "100%" }}>{b}</View>
    </Row>
  );

  if (!isNew && (q.isLoading || q.isError)) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }}><ScreenHeader back title="Unit" />{q.isLoading ? <SkeletonList n={4} /> : <ErrorState onRetry={() => q.refetch()} />}</View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title={isNew ? "Add unit" : `${u.tower}-${u.unit_no}`} subtitle={isNew ? "New inventory unit" : u.project_name} testID="manage-unit-header" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        {locked && (
          <Card testID="unit-locked-warning" style={{ borderColor: `${statusColor(colors, u.status)}88` }}>
            <Row style={{ alignItems: "flex-start" }}>
              <Icon name="warning-outline" size={18} color={statusColor(colors, u.status)} />
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="bodyStrong">This unit is {u.status}{u.buyer_name ? ` · ${u.buyer_name}` : ""}</Txt>
                <Txt variant="caption">It cannot be deleted and its status is managed by booking actions. Edits need your confirmation.{u.agreement_value ? ` Agreement value ${inrFull(u.agreement_value)}.` : ""}</Txt>
              </View>
            </Row>
          </Card>
        )}
        {pair(<Field label="Tower *" testID="unit-tower-input" value={f.tower} onChangeText={set("tower")} placeholder="A" autoCapitalize="characters" />,
          <Field label="Unit number *" testID="unit-number-input" value={f.unit_no} onChangeText={set("unit_no")} placeholder="1204" />)}
        {pair(<Field label="Floor *" testID="unit-floor-input" value={f.floor} onChangeText={set("floor")} keyboardType="numbers-and-punctuation" placeholder="12" />,
          <Field label="BHK *" testID="unit-bhk-input" value={f.bhk} onChangeText={set("bhk")} keyboardType="number-pad" placeholder="3" />)}
        {pair(<Field label="Carpet area (sq.ft) *" testID="unit-carpet-input" value={f.carpet_area} onChangeText={set("carpet_area")} keyboardType="number-pad" />,
          <Field label="Super area (sq.ft)" testID="unit-super-input" value={f.super_area} onChangeText={set("super_area")} keyboardType="number-pad" />)}
        <Field label="Base price (₹) *" testID="unit-price-input" value={f.base_price} onChangeText={set("base_price")} keyboardType="number-pad" placeholder="8500000" />
        {!!f.base_price && !Number.isNaN(Number(f.base_price)) && <Txt variant="caption" style={{ marginTop: -spacing.md }}>{inrFull(Number(f.base_price))}</Txt>}
        <ChipPick label="Facing" options={FACINGS} value={facing} onChange={setFacing} testID="unit-facing" />
        <ChipPick label="Unit type" options={UNIT_TYPES} value={utype} onChange={setUtype} testID="unit-type" />
        {!locked && <ChipPick label="Status" options={["available", "blocked"]} value={status} onChange={setStatus} testID="unit-status" />}
        <Field label="Parking" testID="unit-parking-input" value={f.parking} onChangeText={set("parking")} placeholder="1 covered" />
        <Field label="Notes" testID="unit-notes-input" value={f.notes} onChangeText={set("notes")} multiline style={{ height: 90, paddingTop: spacing.md, textAlignVertical: "top" }} />
        <Btn title={isNew ? "Add unit" : "Save unit"} icon="checkmark" testID="unit-save-button" loading={busy === "save"} onPress={save} />

        {!isNew && (
          <>
            <Section title="Floor plan" />
            {plan ? (
              plan.content_type.startsWith("image/") ? (
                <Image testID="unit-floor-plan-image" source={{ uri: fileUrl(plan.url) }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }} contentFit="contain" />
              ) : (
                <Card><Row><Icon name="document-text-outline" size={22} color={colors.brandSecondary} /><Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{plan.filename}</Txt><Btn small title="Open" variant="secondary" testID="unit-floor-plan-open" onPress={() => openFile(plan.url)} /></Row></Card>
              )
            ) : <Txt variant="caption">No floor plan yet. Upload an image or PDF.</Txt>}
            <Btn title={plan ? "Replace floor plan" : "Upload floor plan"} variant="ghost" icon="cloud-upload-outline" testID="unit-floor-plan-upload" loading={busy === "plan"} onPress={uploadPlan} />
            <Section title="Danger zone" />
            {locked ? <Badge label={`${u.status.toUpperCase()} UNITS CANNOT BE DELETED`} color={colors.muted} testID="unit-delete-blocked" /> : (
              <Btn title="Delete unit" variant="danger" icon="trash-outline" testID="unit-delete-button" loading={busy === "delete"} onPress={remove} />
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
