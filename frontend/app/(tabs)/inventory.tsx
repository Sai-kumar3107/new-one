import { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { api, fileUrl } from "@/src/api";
import { useAuth } from "@/src/auth";
import { inr } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { Badge, Btn, Card, Chip, ChipRow, EmptyState, ErrorState, Pressy, Row, Skeleton, statusColor, Txt, centered, useLayout } from "@/src/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const FACINGS = ["North", "East", "South", "West"];
const STATUSES = ["available", "reserved", "sold", "blocked"];

export default function Inventory() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { gutter } = useLayout();
  const { user } = useAuth();
  const [pid, setPid] = useState<string | null>(null);
  const [tower, setTower] = useState<string | null>(null);
  const [facing, setFacing] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<any[]>("/projects") });
  const project = projects.data?.find((p) => p.id === pid);
  useEffect(() => {
    if (!pid && projects.data?.length) setPid(projects.data[0].id);
  }, [pid, projects.data]);
  useEffect(() => {
    setTower(project?.towers?.[0] ?? null);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = useQuery({
    enabled: !!pid && project?.status !== "upcoming",
    queryKey: ["units", pid, tower, facing, status],
    queryFn: () => {
      const p = new URLSearchParams();
      if (tower) p.set("tower", tower);
      if (facing) p.set("facing", facing);
      if (status) p.set("status", status);
      return api(`/projects/${pid}/units?${p.toString()}`);
    },
  });

  const floors = useMemo(() => {
    const m = new Map<number, any[]>();
    ((units.data as any)?.units ?? []).forEach((u: any) => {
      if (!m.has(u.floor)) m.set(u.floor, []);
      m.get(u.floor)!.push(u);
    });
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [units.data]);
  const cols = project?.towers?.length ? Math.max(...floors.map(([, us]) => us.length), 1) : 4;

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Txt variant="title">Inventory</Txt>
            <Txt variant="caption">Live unit availability · tap a unit to reserve or book</Txt>
          </View>
          {user?.role === "org_admin" && <Btn small title="Manage" icon="construct-outline" variant="secondary" testID="inventory-manage-button" onPress={() => router.push("/manage/projects")} />}
        </Row>
      </View>
      <View style={s.chrome}>
        <ChipRow testID="project-chip-row">
          {(projects.data ?? []).map((p) => (
            <Chip key={p.id} label={p.name} selected={pid === p.id} onPress={() => setPid(p.id)} testID={`project-chip-${p.id}`} />
          ))}
          {projects.isLoading && [0, 1].map((i) => <Skeleton key={i} h={36} w={120} r={radius.pill} />)}
        </ChipRow>
        {project?.status !== "upcoming" && (
          <ChipRow testID="filter-chip-row">
            {(project?.towers ?? []).map((t: string) => (
              <Chip key={t} label={`Tower ${t}`} selected={tower === t} onPress={() => setTower(t)} testID={`tower-chip-${t}`} />
            ))}
            {FACINGS.map((f) => (
              <Chip key={f} label={f} selected={facing === f} onPress={() => setFacing(facing === f ? null : f)} testID={`facing-chip-${f.toLowerCase()}`} />
            ))}
            {STATUSES.map((st) => (
              <Chip key={st} label={st[0].toUpperCase() + st.slice(1)} dot={statusColor(colors, st)} selected={status === st} onPress={() => setStatus(status === st ? null : st)} testID={`status-chip-${st}`} />
            ))}
          </ChipRow>
        )}
      </View>

      {projects.isError ? (
        <ErrorState onRetry={() => projects.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: bottomChrome + spacing.xl, gap: spacing.lg }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={units.isRefetching} onRefresh={() => { projects.refetch(); units.refetch(); }} />}
        >
          {project && (
            <View style={s.projectCard} testID="project-summary-card">
              <Image source={{ uri: fileUrl(project.image_url) }} style={s.projImg} contentFit="cover" transition={250} />
              <LinearGradient colors={["transparent", colors.scrim]} style={s.projScrim} />
              <View style={s.projText}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt variant="h2">{project.name}</Txt>
                  <Badge label={project.status.toUpperCase()} color={project.status === "active" ? colors.success : colors.brandTertiary} />
                </Row>
                <Txt variant="caption" color={colors.onSurfaceTertiary}>{project.location}, {project.city} · from {inr(project.price_from)} · RERA {project.rera}</Txt>
              </View>
            </View>
          )}

          {project?.status === "upcoming" ? (
            <Card testID="upcoming-launch-card">
              <Txt variant="label" color={colors.brandTertiary}>Upcoming launch · {project.launch}</Txt>
              <Txt variant="h3" style={{ marginTop: spacing.sm }}>{project.description}</Txt>
              <Txt variant="caption" style={{ marginTop: spacing.sm }}>Buyers whose budget & location match will receive a launch alert when inventory opens.</Txt>
            </Card>
          ) : (
            <>
              {project && (
                <Row style={{ justifyContent: "space-between" }} testID="inventory-stats">
                  {STATUSES.map((st) => (
                    <View key={st} style={{ alignItems: "flex-start" }}>
                      <Txt variant="h2" color={statusColor(colors, st)} testID={`inventory-count-${st}`}>{project.stats[st]}</Txt>
                      <Txt variant="caption">{st}</Txt>
                    </View>
                  ))}
                </Row>
              )}
              {units.isLoading || !project ? (
                <View style={{ gap: spacing.sm }} testID="loading-skeleton">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Row key={i}>{Array.from({ length: 4 }).map((__, j) => <Skeleton key={j} h={64} w="23%" r={radius.md} />)}</Row>
                  ))}
                </View>
              ) : units.isError ? (
                <ErrorState onRetry={() => units.refetch()} />
              ) : floors.length === 0 ? (
                <EmptyState icon="grid-outline" title="No units match your filter" sub="Clear facing or status filters to see the full tower." />
              ) : (
                <View style={{ gap: spacing.sm }} testID="inventory-grid">
                  {floors.map(([floor, us]) => (
                    <Row key={floor} style={{ gap: spacing.sm, alignItems: "stretch" }}>
                      <View style={s.floorLabel}><Txt variant="caption">F{floor}</Txt></View>
                      {us.map((u: any) => {
                        const c = statusColor(colors, u.status);
                        return (
                          <Pressy
                            key={u.id}
                            testID={`unit-cell-${u.tower}-${u.unit_no}`}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                              router.push(`/unit/${u.id}`);
                            }}
                            style={[s.cell, { borderColor: `${c}66`, backgroundColor: `${c}1A` }]}
                          >
                            <View style={[s.cellBar, { backgroundColor: c }]} />
                            <Txt variant="bodyStrong">{u.unit_no}</Txt>
                            <Txt variant="caption">{u.bhk}BHK · {u.facing[0]}</Txt>
                          </Pressy>
                        );
                      })}
                      {Array.from({ length: Math.max(0, cols - us.length) }).map((_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
                    </Row>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, backgroundColor: c.surface },
  chrome: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  projectCard: { height: 150, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  projImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  projScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  projText: { flex: 1, justifyContent: "flex-end", padding: spacing.lg, gap: 4 },
  floorLabel: { width: 32, justifyContent: "center" },
  cell: { flex: 1, minHeight: 64, borderRadius: radius.md, borderWidth: 1, padding: spacing.sm, justifyContent: "flex-end", overflow: "hidden" },
  cellBar: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
}));
