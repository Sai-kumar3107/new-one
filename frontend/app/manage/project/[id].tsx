import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api";
import { useToast } from "@/src/toast";
import { Chip, ErrorState, IconBtn, Row, ScreenHeader, SkeletonList, centered } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";
import { ProjectForm } from "@/src/manage/ProjectForm";
import { MediaSection } from "@/src/manage/MediaSection";
import { UnitsSection } from "@/src/manage/UnitsSection";
import { confirmAsk } from "@/src/manage/helpers";

const TABS = [["units", "Units"], ["details", "Details"], ["media", "Photos & brochure"]] as const;

export default function ManageProject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("units");
  const q = useQuery({ enabled: !isNew, queryKey: ["project", id], queryFn: () => api(`/projects/${id}`) });
  const p: any = q.data;

  const archive = async () => {
    if (!(await confirmAsk("Archive project?", `${p.name} will be hidden from inventory and lead forms. You can restore it later.`, "Archive", true))) return;
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
    } catch (e: any) {
      if (!(e instanceof ApiError && e.status === 409 && e.message.includes("Confirm"))) return toast.show(e.message, "error");
      if (!(await confirmAsk("Project has sold units", e.message, "Archive anyway", true))) return;
      try { await api(`/projects/${id}?confirm=true`, { method: "DELETE" }); } catch (e2: any) { return toast.show(e2.message, "error"); }
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    toast.show("Project archived");
    if (router.canGoBack()) router.back();
    else router.replace("/manage/projects");
  };

  const body = isNew ? (
    <ProjectForm onSaved={(saved) => router.replace(`/manage/project/${saved.id}`)} />
  ) : q.isLoading ? <SkeletonList n={4} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
    <>
      <Row style={{ gap: spacing.sm, flexWrap: "wrap", marginBottom: tab === "details" ? spacing.lg : 0 }}>
        {TABS.map(([k, l]) => <Chip key={k} label={l} selected={tab === k} onPress={() => setTab(k)} testID={`manage-tab-${k}`} />)}
      </Row>
      {tab === "details" && <ProjectForm key={p.updated_at} project={p} onSaved={() => q.refetch()} />}
      {tab === "media" && <MediaSection project={p} />}
      {tab === "units" && <UnitsSection project={p} />}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader back title={isNew ? "New project" : p?.name ?? "Project"} subtitle={isNew ? "Add the basics — units and media come next" : p ? `${p.total_units} units · ${p.stats.available} available` : undefined}
        testID="manage-project-header" right={!isNew && p && !p.archived ? <IconBtn icon="archive-outline" testID="manage-archive-button" onPress={archive} /> : undefined} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...centered, padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        {body}
      </KeyboardAwareScrollView>
    </View>
  );
}
