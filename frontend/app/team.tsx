import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ROLE_LABEL, timeAgo } from "@/src/format";
import { useToast } from "@/src/toast";
import { Avatar, Badge, Btn, Card, Chip, ErrorState, Field, Row, ScreenHeader, Sheet, SkeletonList, Txt, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function Team() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, org } = useAuth();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "sales_exec" });
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<any[]>("/users"), refetchInterval: 30000 });
  const m = useMutation({
    mutationFn: () => api("/users", { body: f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); setF({ name: "", email: "", password: "", role: "sales_exec" }); toast.show("Team member added"); },
    onError: (e: Error) => toast.show(e.message, "error"),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title="Team" subtitle={user?.role === "org_admin" ? `${q.data?.length ?? "–"} of ${org?.seats ?? "–"} seats · live status` : `${q.data?.length ?? "–"} members · live status`} right={user?.role === "org_admin" ? <Btn small title="Add" icon="person-add-outline" testID="team-add-button" onPress={() => setOpen(true)} /> : undefined} />
      {q.isLoading ? <SkeletonList /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl tintColor={colors.muted} refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} />}
          renderItem={({ item: u }) => (
            <Card testID={`team-member-${u.id}`} style={{ padding: spacing.md }}>
              <Row style={{ gap: spacing.md }}>
                <Avatar name={u.name} online={u.online} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{u.name}</Txt>
                  <Txt variant="caption">{u.email}</Txt>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Badge label={ROLE_LABEL[u.role]} color={colors.brandSecondary} />
                  <Txt variant="caption" testID={`team-status-${u.id}`}>{u.online ? "Online" : u.last_seen ? `Seen ${timeAgo(u.last_seen)}` : "Never active"}</Txt>
                </View>
              </Row>
            </Card>
          )}
        />
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Add team member" testID="add-user-sheet">
        <Field label="Name" testID="new-user-name-input" value={f.name} onChangeText={set("name")} />
        <Field label="Email" testID="new-user-email-input" value={f.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Temporary password" testID="new-user-password-input" value={f.password} onChangeText={set("password")} secureTextEntry placeholder="Min 8 characters" />
        <Row style={{ flexWrap: "wrap" }}>
          {["sales_exec", "finance", "org_admin"].map((r) => <Chip key={r} label={ROLE_LABEL[r]} selected={f.role === r} onPress={() => set("role")(r)} testID={`new-user-role-${r}`} />)}
        </Row>
        <Btn title="Create account" testID="new-user-submit-button" loading={m.isPending} onPress={() => m.mutate()} />
      </Sheet>
    </View>
  );
}
