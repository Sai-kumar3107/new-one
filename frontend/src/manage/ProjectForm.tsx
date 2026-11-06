import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/api";
import { useToast } from "@/src/toast";
import { Btn, Field, Row, useLayout } from "@/src/ui";
import { spacing } from "@/src/theme";
import { ChipPick } from "@/src/manage/ChipPick";
import { lakh, list, num, PROJECT_STATUSES, PROJECT_TYPES, str } from "@/src/manage/helpers";

const TEXT = ["name", "location", "city", "state", "address", "pincode", "rera", "launch", "possession_date", "total_area", "description"] as const;

export function ProjectForm({ project, onSaved }: { project?: any; onSaved: (p: any) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { wide } = useLayout();
  const p = project ?? {};
  const [f, setF] = useState<Record<string, string>>({
    ...Object.fromEntries(TEXT.map((k) => [k, str(p[k])])),
    price: p.price_from ? String(p.price_from / 1e5) : "",
    floors: p.floors ? String(p.floors) : "",
    towers: (p.towers ?? []).join(", "),
    amenities: (p.amenities ?? []).join(", "),
    lat: str(p.lat),
    lng: str(p.lng),
  });
  const [type, setType] = useState<string>(p.project_type ?? "residential");
  const [status, setStatus] = useState<string>(p.status ?? "upcoming");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (f.name.trim().length < 2) return toast.show("Project name is required", "error");
    if ([f.price, f.floors, f.lat, f.lng].some((v) => v.trim() && Number.isNaN(Number(v)))) return toast.show("Price, floors and coordinates must be numbers", "error");
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries(TEXT.map((k) => [k, f[k].trim()])),
        project_type: type, status, price_from: lakh(f.price), floors: num(f.floors) ?? 0, lat: num(f.lat), lng: num(f.lng),
        towers: list(f.towers), amenities: list(f.amenities),
      };
      const saved = project ? await api(`/projects/${project.id}`, { method: "PATCH", body }) : await api("/projects", { body });
      ["projects", "project"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.show(project ? "Project saved" : "Project created");
      onSaved(saved);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const pair = (a: React.ReactNode, b: React.ReactNode) =>
    wide ? <Row style={{ gap: spacing.md, alignItems: "flex-start" }}><View style={{ flex: 1 }}>{a}</View><View style={{ flex: 1 }}>{b}</View></Row> : <>{a}{b}</>;

  return (
    <View style={{ gap: spacing.lg }} testID="project-form">
      <Field label="Project name *" testID="project-name-input" value={f.name} onChangeText={set("name")} placeholder="e.g. Skyline Heights" />
      <ChipPick label="Project type" options={PROJECT_TYPES} value={type} onChange={(v) => setType(v!)} testID="project-type" />
      <ChipPick label="Status" options={PROJECT_STATUSES} value={status} onChange={(v) => setStatus(v!)} testID="project-status" />
      {pair(<Field label="Locality" testID="project-location-input" value={f.location} onChangeText={set("location")} placeholder="Whitefield" />,
        <Field label="City" testID="project-city-input" value={f.city} onChangeText={set("city")} placeholder="Bengaluru" />)}
      {pair(<Field label="State" testID="project-state-input" value={f.state} onChangeText={set("state")} placeholder="Karnataka" />,
        <Field label="Pincode" testID="project-pincode-input" value={f.pincode} onChangeText={set("pincode")} keyboardType="number-pad" maxLength={6} />)}
      <Field label="Address" testID="project-address-input" value={f.address} onChangeText={set("address")} placeholder="Street, landmark" />
      {pair(<Field label="Starting price (₹ Lakh)" testID="project-price-input" value={f.price} onChangeText={set("price")} keyboardType="decimal-pad" placeholder="85" />,
        <Field label="RERA number" testID="project-rera-input" value={f.rera} onChangeText={set("rera")} autoCapitalize="characters" />)}
      {pair(<Field label="Launch (YYYY-MM)" testID="project-launch-input" value={f.launch} onChangeText={set("launch")} placeholder="2026-01" />,
        <Field label="Possession date" testID="project-possession-input" value={f.possession_date} onChangeText={set("possession_date")} placeholder="Dec 2028" />)}
      {pair(<Field label="Towers (comma separated)" testID="project-towers-input" value={f.towers} onChangeText={set("towers")} placeholder="A, B" />,
        <Field label="Floors" testID="project-floors-input" value={f.floors} onChangeText={set("floors")} keyboardType="number-pad" />)}
      {pair(<Field label="Total land area" testID="project-area-input" value={f.total_area} onChangeText={set("total_area")} placeholder="4.5 acres" />,
        <Field label="Amenities (comma separated)" testID="project-amenities-input" value={f.amenities} onChangeText={set("amenities")} placeholder="Clubhouse, Pool" />)}
      {pair(<Field label="Latitude" testID="project-lat-input" value={f.lat} onChangeText={set("lat")} keyboardType="numbers-and-punctuation" />,
        <Field label="Longitude" testID="project-lng-input" value={f.lng} onChangeText={set("lng")} keyboardType="numbers-and-punctuation" />)}
      <Field label="Description" testID="project-description-input" value={f.description} onChangeText={set("description")} multiline
        style={{ height: 110, paddingTop: spacing.md, textAlignVertical: "top" }} placeholder="Highlights buyers should know" />
      <Btn title={project ? "Save changes" : "Create project"} icon="checkmark" testID="project-save-button" loading={busy} onPress={save} />
    </View>
  );
}
