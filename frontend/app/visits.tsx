import { FlatList, Linking, RefreshControl, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { canEditLeads, useAuth } from "@/src/auth";
import { fmtDateTime } from "@/src/format";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, EmptyState, ErrorState, Pressy, Row, ScreenHeader, SkeletonList, Txt, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function Visits() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["visits"], queryFn: () => api<any[]>("/site-visits") });
  const m = useMutation({
    mutationFn: ({ vid, status }: { vid: string; status: string }) => api(`/site-visits/${vid}`, { method: "PATCH", body: { status } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["visits"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.show("Visit updated"); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  const c = (s: string) => (s === "completed" ? colors.success : s === "scheduled" ? colors.brandSecondary : colors.muted);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Site visits" subtitle="Scheduled tours & outcomes" />
      {q.isLoading ? <SkeletonList /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title="No site visits yet" sub="Schedule one from a lead's profile." />}
          renderItem={({ item: v }) => (
            <Card testID={`visit-card-${v.id}`}>
              <Pressy onPress={() => router.push(`/lead/${v.lead_id}`)}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{v.lead_name}</Txt>
                    <Txt variant="caption">{v.project_name} · {v.location}</Txt>
                  </View>
                  <Badge label={v.status.replace("_", " ").toUpperCase()} color={c(v.status)} />
                </Row>
                <Txt variant="bodyStrong" style={{ marginTop: spacing.sm }}>{fmtDateTime(v.scheduled_at)}</Txt>
                <Txt variant="caption">{v.assigned_name}</Txt>
              </Pressy>
              <Row style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <Btn small variant="ghost" title="Map" icon="navigate-outline" testID={`visit-map-${v.id}`} onPress={() => Linking.openURL(v.maps_url).catch(() => {})} style={{ flex: 1 }} />
                {canEditLeads(user?.role) && v.status === "scheduled" && (
                  <>
                    <Btn small title="Done" icon="checkmark" testID={`visit-complete-${v.id}`} onPress={() => m.mutate({ vid: v.id, status: "completed" })} style={{ flex: 1 }} />
                    <Btn small variant="danger" title="No-show" testID={`visit-noshow-${v.id}`} onPress={() => m.mutate({ vid: v.id, status: "no_show" })} style={{ flex: 1 }} />
                  </>
                )}
              </Row>
            </Card>
          )}
        />
      )}
    </View>
  );
}
