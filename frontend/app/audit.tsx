import { FlatList, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ROLE_LABEL, timeAgo } from "@/src/format";
import { EmptyState, ErrorState, Icon, Row, ScreenHeader, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Audit() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<any[]>("/audit") });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Audit log" subtitle="Immutable record of sensitive actions" />
      {q.isLoading ? <SkeletonList h={60} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState icon="shield-outline" title="No audit events yet" />}
          renderItem={({ item: a }) => (
            <Row testID={`audit-row-${a.id}`} style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "flex-start", gap: spacing.md }}>
              <Icon name={a.action === "duplicate_blocked" ? "warning-outline" : "shield-checkmark-outline"} size={18} color={a.action === "duplicate_blocked" ? colors.warning : colors.muted} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{a.user_name} · {a.action.replace("_", " ")} {a.entity}</Txt>
                {!!a.detail && <Txt variant="caption" numberOfLines={2}>{a.detail}</Txt>}
                <Txt variant="caption">{ROLE_LABEL[a.role]} · {timeAgo(a.created_at)}</Txt>
              </View>
            </Row>
          )}
        />
      )}
    </View>
  );
}
