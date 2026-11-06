import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";

import { api, apiUpload, fileUrl, openFile } from "@/src/api";
import { useToast } from "@/src/toast";
import { Badge, Btn, Card, EmptyState, Icon, Pressy, Row, Section, Txt, useLayout } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { confirmAsk, pickImages } from "@/src/manage/helpers";

export function MediaSection({ project }: { project: any }) {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { cols } = useLayout();
  const [busy, setBusy] = useState<string | null>(null);
  const images = (project.assets ?? []).filter((a: any) => a.kind === "image" && !a.unit_id);
  const brochure = (project.assets ?? []).find((a: any) => a.id === project.brochure_asset_id);
  const refresh = () => ["project", "projects"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const upload = async (files: { uri: string; name?: string; mimeType?: string }[], kind: string) => {
    if (!files.length) return;
    setBusy(kind);
    let ok = 0;
    for (const file of files) {
      try {
        await apiUpload(`/projects/${project.id}/assets`, file, { kind });
        ok++;
      } catch (e: any) {
        toast.show(`${file.name ?? "File"}: ${e.message}`, "error");
      }
    }
    setBusy(null);
    if (ok) toast.show(kind === "brochure" ? "Brochure uploaded" : `${ok} photo${ok > 1 ? "s" : ""} uploaded`);
    refresh();
  };

  const addBrochure = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    upload([{ uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/pdf" }], "brochure");
  };

  const remove = async (a: any) => {
    if (!(await confirmAsk("Remove file?", `${a.filename} will be removed from this project.`, "Remove", true))) return;
    try {
      await api(`/assets/${a.id}`, { method: "DELETE" });
      toast.show("File removed");
      refresh();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const setCover = async (a: any) => {
    try {
      await api(`/projects/${project.id}`, { method: "PATCH", body: { cover_asset_id: a.id } });
      toast.show("Cover photo updated");
      refresh();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const tile = `${100 / Math.max(2, cols + 1) - 2}%` as `${number}%`;
  return (
    <View testID="media-section">
      <Section title={`Photos · ${images.length}`} />
      {images.length === 0 ? (
        <EmptyState icon="images-outline" title="No photos yet" sub="Add exterior, amenity and sample-flat photos. The first one becomes the cover." testID="media-empty" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {images.map((a: any) => (
            <View key={a.id} style={{ width: tile, gap: 6 }} testID={`media-image-${a.id}`}>
              <Image source={{ uri: fileUrl(a.url) }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }} contentFit="cover" transition={200} />
              <Row style={{ justifyContent: "space-between" }}>
                {project.cover_asset_id === a.id ? <Badge label="COVER" color={colors.success} /> : (
                  <Pressy testID={`media-cover-${a.id}`} onPress={() => setCover(a)} hitSlop={8}><Txt variant="caption" color={colors.brandSecondary}>Set cover</Txt></Pressy>
                )}
                <Pressy testID={`media-delete-${a.id}`} onPress={() => remove(a)} hitSlop={10} style={{ padding: 6 }}><Icon name="trash-outline" size={18} color={colors.error} /></Pressy>
              </Row>
            </View>
          ))}
        </View>
      )}
      <Btn title="Add photos" icon="image-outline" variant="ghost" style={{ marginTop: spacing.md }} testID="media-add-photos-button" loading={busy === "image"}
        onPress={async () => upload(await pickImages(true), "image")} />

      <Section title="Brochure" />
      <Card>
        {brochure ? (
          <Row style={{ gap: spacing.md }} testID="media-brochure-row">
            <Icon name="document-text-outline" size={28} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>{brochure.filename}</Txt>
              <Txt variant="caption">{(brochure.size / 1024 / 1024).toFixed(1)} MB · PDF</Txt>
            </View>
            <Btn small title="Open" variant="secondary" testID="media-brochure-open" onPress={() => openFile(brochure.url)} />
            <Pressy testID="media-brochure-delete" onPress={() => remove(brochure)} style={{ padding: 6 }}><Icon name="trash-outline" size={18} color={colors.error} /></Pressy>
          </Row>
        ) : (
          <Txt variant="caption">No brochure uploaded. PDF up to 25 MB.</Txt>
        )}
      </Card>
      {busy === "brochure" ? <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.onSurface} /> : (
        <Btn title={brochure ? "Replace brochure" : "Upload brochure (PDF)"} icon="cloud-upload-outline" variant="ghost" style={{ marginTop: spacing.md }} testID="media-brochure-upload-button" onPress={addBrochure} />
      )}
    </View>
  );
}
