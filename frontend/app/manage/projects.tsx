import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, fileUrl } from "@/src/api";
import { useAuth } from "@/src/auth";
import { inr } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Chip, ChipRow, EmptyState, ErrorState, Icon, IconBtn, Pressy, Row, ScreenHeader, SkeletonList, Txt, centered, statusColor, useLayout, webNoOutline } from "@/src/ui";
import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { titleCase } from "@/src/manage/helpers";

const FILTERS = ["all", "active", "upcoming", "completed", "archived"];
const SORTS: [string, string][] = [["created", "Newest"], ["name", "Name"], ["price", "Price"], ["availability", "Most available"]];

export default function ManageProjects() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { cols } = useLayout();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("created");
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  const projects = useQuery({
    queryKey: ["projects", "manage", dq, filter, sort],
    queryFn: () => {
      const p = new URLSearchParams({ sort });
      if (dq) p.set("q", dq);
      if (filter === "archived") p.set("include_archived", "true");
      else if (filter !== "all") p.set("status", filter);
      return api<any[]>(`/projects?${p.toString()}`);
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/projects/${id}/restore`, { body: {} }),
    onSuccess: () => { toast.show("Project restored"); qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });

  if (user && user.role !== "org_admin") {
    return <View style={{ flex: 1, backgroundColor: colors.surface }}><ScreenHeader back title="Projects" /><EmptyState icon="lock-closed-outline" title="Admins only" sub="Only organization admins can manage projects." /></View>;
  }
  const items = (projects.data ?? []).filter((p) => (filter === "archived" ? p.archived : !p.archived));
  const width = `${100 / cols}%` as `${number}%`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Projects & inventory" subtitle="Create projects, manage units and media" testID="manage-projects-header"
        right={<IconBtn icon="add" testID="manage-new-project-button" onPress={() => router.push("/manage/project/new")} />} />
      <View style={[centered, { paddingHorizontal: spacing.lg, paddingTop: spacing.md }]}>
        <Row style={{ height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md }}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput testID="manage-projects-search" value={q} onChangeText={setQ} placeholder="Search name, city, RERA" placeholderTextColor={colors.muted}
            style={[{ flex: 1, color: colors.onSurface, fontFamily: fonts.medium, fontSize: 15, height: 46 }, webNoOutline]} />
        </Row>
      </View>
      <ChipRow testID="manage-projects-filter">
        {FILTERS.map((f) => <Chip key={f} label={titleCase(f)} selected={filter === f} onPress={() => setFilter(f)} testID={`manage-filter-${f}`} />)}
        <View style={{ width: 1, height: 24, backgroundColor: colors.border }} />
        {SORTS.map(([k, l]) => <Chip key={k} label={l} selected={sort === k} onPress={() => setSort(k)} testID={`manage-sort-${k}`} />)}
      </ChipRow>
      {projects.isLoading ? <SkeletonList n={3} h={160} /> : projects.isError ? <ErrorState onRetry={() => projects.refetch()} /> : (
        <ScrollView
          contentContainerStyle={{ ...centered, padding: spacing.lg - spacing.xs, paddingBottom: insets.bottom + spacing.xxl, flexDirection: "row", flexWrap: "wrap" }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={projects.isRefetching} onRefresh={() => { projects.refetch(); }} />}
        >
          {items.length === 0 && (
            <View style={{ width: "100%" }}>
              <EmptyState icon="business-outline" title={dq || filter !== "all" ? "No projects match" : "No projects yet"} sub="Create your first project to start adding inventory."
                action={<Btn small title="New project" icon="add" style={{ marginTop: spacing.md }} testID="manage-empty-new-project" onPress={() => router.push("/manage/project/new")} />} />
            </View>
          )}
          {items.map((p) => (
            <View key={p.id} style={{ width, padding: spacing.xs }}>
              <Pressy testID={`manage-project-card-${p.id}`} onPress={() => router.push(`/manage/project/${p.id}`)}
                style={{ borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }}>
                {p.image_url ? <Image source={{ uri: fileUrl(p.image_url) }} style={{ height: 120, width: "100%" }} contentFit="cover" transition={200} /> : (
                  <View style={{ height: 120, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary }}><Icon name="business-outline" size={32} color={colors.muted} /></View>
                )}
                <View style={{ padding: spacing.md, gap: 6 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Txt>
                    <Badge label={(p.archived ? "archived" : p.status).toUpperCase()} color={p.archived ? colors.muted : p.status === "active" ? colors.success : p.status === "upcoming" ? colors.brandTertiary : colors.info} />
                  </Row>
                  <Txt variant="caption" numberOfLines={1}>{[p.location, p.city].filter(Boolean).join(", ") || "Location not set"} · {titleCase(p.project_type ?? "residential")} · from {inr(p.price_from)}</Txt>
                  <Row style={{ gap: spacing.md }}>
                    {(["available", "reserved", "sold", "blocked"] as const).map((st) => (
                      <Row key={st} style={{ gap: 4 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(colors, st) }} />
                        <Txt variant="caption" testID={`manage-project-${p.id}-${st}`}>{p.stats[st]}</Txt>
                      </Row>
                    ))}
                    <Txt variant="caption" style={{ marginLeft: "auto" }}>{p.total_units} units</Txt>
                  </Row>
                  {p.archived && <Btn small title="Restore" variant="secondary" icon="refresh" testID={`manage-restore-${p.id}`} loading={restore.isPending} onPress={() => restore.mutate(p.id)} />}
                </View>
              </Pressy>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
