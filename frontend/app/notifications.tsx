import { useEffect } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { timeAgo } from "@/src/format";
import { EmptyState, ErrorState, Icon, Pressy, Row, ScreenHeader, SkeletonList, Txt, centered } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Notifications() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications") });
  useEffect(() => {
    api("/notifications/read", { body: {} }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
  }, [qc]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Alerts" subtitle="Leads, bookings, visits & payouts" />
      {q.isLoading ? <SkeletonList h={64} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <FlatList
          data={(q.data as any).items}
          keyExtractor={(n: any) => n.id}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState icon="notifications-off-outline" title="You're all caught up" />}
          renderItem={({ item: n }: any) => (
            <Pressy testID={`notification-${n.id}`} onPress={() => n.link && router.push(n.link)}>
              <Row style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: spacing.md, borderWidth: 1, borderColor: n.read ? colors.border : colors.brandPrimary }}>
                <Icon name={n.kind === "booking" ? "trophy-outline" : n.kind === "commission" ? "cash-outline" : n.kind === "visit" ? "location-outline" : "flash-outline"} size={18} color={n.read ? colors.muted : colors.brandSecondary} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{n.title}</Txt>
                  <Txt variant="caption">{n.body} · {timeAgo(n.created_at)}</Txt>
                </View>
              </Row>
            </Pressy>
          )}
        />
      )}
    </View>
  );
}
