import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { api, openFile } from "@/src/api";
import { inr } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Chip, ChipRow, EmptyState, ErrorState, Icon, Pressy, Row, SkeletonList, statusColor, Txt, webNoOutline } from "@/src/ui";
import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { ImportSheet } from "@/src/manage/ImportSheet";

const STATUSES = ["available", "reserved", "sold", "blocked"];
const SORTS: [string, string][] = [["floor", "Floor"], ["unit_no", "Unit no"], ["price_asc", "Price ↑"], ["price_desc", "Price ↓"], ["area", "Area"]];

export function UnitsSection({ project }: { project: any }) {
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tower, setTower] = useState<string | null>(null);
  const [bhk, setBhk] = useState<number | null>(null);
  const [sort, setSort] = useState("floor");
  const [importing, setImporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  const units = useQuery({
    queryKey: ["units", project.id, "manage", dq, status, tower, bhk, sort],
    queryFn: () => {
      const p = new URLSearchParams({ sort });
      if (dq) p.set("q", dq);
      if (status) p.set("status", status);
      if (tower) p.set("tower", tower);
      if (bhk !== null) p.set("bhk", String(bhk));
      return api(`/projects/${project.id}/units?${p.toString()}`);
    },
  });
  const items: any[] = (units.data as any)?.units ?? [];

  const exportFile = async (format: string) => {
    try {
      const { url } = await api(`/projects/${project.id}/units/export-link?format=${format}`, { body: {} });
      openFile(url);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View testID="units-section">
      <Row style={{ flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
        <Btn small title="Add unit" icon="add" testID="units-add-button" onPress={() => router.push(`/manage/unit/new?projectId=${project.id}`)} />
        <Btn small title="Import" icon="cloud-upload-outline" variant="secondary" testID="units-import-button" onPress={() => setImporting(true)} />
        <Btn small title="Export CSV" icon="download-outline" variant="secondary" testID="units-export-csv" onPress={() => exportFile("csv")} />
        <Btn small title="Export Excel" icon="download-outline" variant="secondary" testID="units-export-xlsx" onPress={() => exportFile("xlsx")} />
      </Row>
      <Row style={{ marginTop: spacing.lg, height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md }}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput testID="units-search-input" value={q} onChangeText={setQ} placeholder="Search unit or tower" placeholderTextColor={colors.muted}
          style={[{ flex: 1, color: colors.onSurface, fontFamily: fonts.medium, fontSize: 15, height: 46 }, webNoOutline]} />
      </Row>
      <View style={{ marginHorizontal: -spacing.lg }}>
        <ChipRow testID="units-filter-row">
          {STATUSES.map((st) => <Chip key={st} label={st[0].toUpperCase() + st.slice(1)} dot={statusColor(colors, st)} selected={status === st} onPress={() => setStatus(status === st ? null : st)} testID={`units-status-${st}`} />)}
          {(project.towers ?? []).map((t: string) => <Chip key={t} label={`Tower ${t}`} selected={tower === t} onPress={() => setTower(tower === t ? null : t)} testID={`units-tower-${t}`} />)}
          {[1, 2, 3, 4].map((b) => <Chip key={b} label={`${b} BHK`} selected={bhk === b} onPress={() => setBhk(bhk === b ? null : b)} testID={`units-bhk-${b}`} />)}
        </ChipRow>
        <ChipRow testID="units-sort-row">
          {SORTS.map(([k, l]) => <Chip key={k} label={l} selected={sort === k} onPress={() => setSort(k)} testID={`units-sort-${k}`} />)}
        </ChipRow>
      </View>
      <Txt variant="caption" style={{ marginBottom: spacing.sm }} testID="units-count">{items.length} unit{items.length === 1 ? "" : "s"}</Txt>
      {units.isLoading ? <SkeletonList n={4} h={64} /> : units.isError ? <ErrorState onRetry={() => units.refetch()} /> : items.length === 0 ? (
        <EmptyState icon="grid-outline" title={dq || status || tower || bhk ? "No units match" : "No units yet"} sub="Add units one by one or import a CSV / Excel sheet." testID="units-empty" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((u) => {
            const c = statusColor(colors, u.status);
            return (
              <Pressy key={u.id} testID={`manage-unit-row-${u.tower}-${u.unit_no}`} onPress={() => router.push(`/manage/unit/${u.id}`)}>
                <Row style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
                  <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: c }} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{u.tower}-{u.unit_no} · Floor {u.floor}</Txt>
                    <Txt variant="caption">{u.bhk} BHK · {u.carpet_area} sq.ft · {u.facing} · {u.unit_type}</Txt>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Txt variant="bodyStrong">{inr(u.base_price)}</Txt>
                    <Badge label={u.status.toUpperCase()} color={c} />
                  </View>
                </Row>
              </Pressy>
            );
          })}
        </View>
      )}
      <ImportSheet projectId={project.id} visible={importing} onClose={() => setImporting(false)} />
    </View>
  );
}
