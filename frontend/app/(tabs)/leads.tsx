import { useState } from "react";
import { FlatList, RefreshControl, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { sourceLabel, STAGE_LABEL, STAGES, timeAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { Chip, ChipRow, EmptyState, ErrorState, Icon, Pressy, Row, SkeletonList, TierBadge, Txt, centered, useLayout, webNoOutline } from "@/src/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Leads() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["leads", stage, search],
    queryFn: () => api(`/leads?stage=${stage}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
  });
  const data: any = q.data;
  const total = data ? Object.values(data.counts as Record<string, number>).reduce((a, b) => a + b, 0) : undefined;
  const canCreate = user?.role === "org_admin" || user?.role === "sales_exec" || user?.role === "channel_partner";
  const { cols, gutter } = useLayout();

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
        <Txt variant="title">{user?.role === "channel_partner" ? "My clients" : "Leads"}</Txt>
        <View style={s.search}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput testID="leads-search-input" value={search} onChangeText={setSearch} placeholder="Search name or phone" placeholderTextColor={colors.muted} style={s.searchInput} />
        </View>
      </View>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <ChipRow testID="stage-chip-row">
          <Chip label="All" count={total} selected={stage === "all"} onPress={() => setStage("all")} testID="stage-chip-all" />
          {STAGES.map((st) => (
            <Chip key={st} label={STAGE_LABEL[st]} count={data?.counts?.[st]} selected={stage === st} onPress={() => setStage(st)} testID={`stage-chip-${st}`} />
          ))}
        </ChipRow>
      </View>
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          key={`cols-${cols}`}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? { gap: spacing.md } : undefined}
          data={cols > 1 ? [...data.items, ...Array.from({ length: (cols - (data.items.length % cols)) % cols }, (_, i) => ({ id: `filler-${i}`, filler: true }))] : data.items}
          keyExtractor={(i: any) => i.id}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + 96 }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No leads in this stage yet" sub="New inquiries from ads, portals and partners land here automatically." />}
          renderItem={({ item, index }: any) => item.filler ? <View style={{ flex: 1 }} /> : (
            <Animated.View style={{ flex: 1 }} entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(300)}>
              <Pressy testID={`lead-card-${item.id}`} onPress={() => router.push(`/lead/${item.id}`)} style={s.card}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Row>
                      <Txt variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</Txt>
                      {item.locked && <Icon name="lock-closed" size={13} color={colors.brandSecondary} />}
                    </Row>
                    <Txt variant="caption" numberOfLines={1}>{item.project_name ?? "No project"} · {sourceLabel(item.source)}</Txt>
                  </View>
                  <TierBadge tier={item.tier} score={item.score} testID={`lead-score-${item.id}`} />
                </Row>
                <Row style={{ marginTop: spacing.md, justifyContent: "space-between" }}>
                  <View style={s.stagePill}><Txt variant="caption" color={colors.onSurfaceTertiary}>{STAGE_LABEL[item.stage]}</Txt></View>
                  <Txt variant="caption">{item.assigned_name ? `${item.assigned_name} · ` : ""}{timeAgo(item.last_activity_at || item.created_at)}</Txt>
                </Row>
              </Pressy>
            </Animated.View>
          )}
        />
      )}
      {canCreate && (
        <Pressy testID="add-lead-fab" haptic onPress={() => router.push("/lead/new")} style={[s.fab, { bottom: bottomChrome + 16 }]}>
          <Icon name="add" size={22} color={colors.onBrandPrimary} />
          <Txt variant="bodyStrong" color={colors.onBrandPrimary}>{user?.role === "channel_partner" ? "Register" : "New lead"}</Txt>
        </Pressy>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xs, backgroundColor: c.surface },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, color: c.onSurface, fontFamily: fonts.medium, fontSize: 14, height: 44, ...webNoOutline },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  stagePill: { paddingHorizontal: 10, height: 24, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, justifyContent: "center" },
  fab: { position: "absolute", right: spacing.lg, height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: c.brandPrimary, flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));
