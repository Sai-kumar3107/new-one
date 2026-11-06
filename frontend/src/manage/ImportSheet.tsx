import { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";

import { api, apiUpload, openFile } from "@/src/api";
import { useToast } from "@/src/toast";
import { Btn, Card, Icon, KV, Row, Sheet, Txt } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

type FileRef = { uri: string; name: string; mimeType?: string };

export function ImportSheet({ projectId, visible, onClose }: { projectId: string; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<FileRef | null>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setFile(null); setRes(null); onClose(); };

  const run = async (f: FileRef, dry: boolean) => {
    setBusy(true);
    try {
      const r = await apiUpload(`/projects/${projectId}/units/import`, f, { dry_run: dry ? "true" : "false" });
      setRes(r);
      if (r.imported) {
        ["units", "projects", "project"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        toast.show(`Imported · ${r.create} new, ${r.update} updated`);
      }
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
      copyToCacheDirectory: true,
    });
    if (r.canceled) return;
    const a = r.assets[0];
    if (!/\.(csv|xlsx)$/i.test(a.name)) return toast.show("Choose a .csv or .xlsx file", "error");
    const f = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined };
    setFile(f);
    run(f, true);
  };

  const template = async (format: string) => {
    try {
      const { url } = await api(`/projects/${projectId}/units/export-link?format=${format}&template=true`, { body: {} });
      openFile(url);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Import units" testID="import-sheet">
      <Txt variant="caption">
        Columns: tower, floor, unit_no, bhk, carpet_area, facing, base_price (required) · super_area, unit_type, parking, status, notes (optional).
        Existing units with the same tower + unit_no are updated. Reserved or sold units are never changed.
      </Txt>
      <Row style={{ gap: spacing.sm }}>
        <Btn small title="CSV template" variant="secondary" icon="download-outline" testID="import-template-csv" onPress={() => template("csv")} />
        <Btn small title="Excel template" variant="secondary" icon="download-outline" testID="import-template-xlsx" onPress={() => template("xlsx")} />
      </Row>
      <Btn title={file ? `Change file · ${file.name}` : "Choose CSV or Excel file"} icon="document-attach-outline" variant="ghost" testID="import-pick-file" loading={busy && !res} onPress={pick} />
      {res && (
        <Card testID="import-summary">
          <Txt variant="label" color={res.imported ? colors.success : colors.muted}>{res.imported ? "Import complete" : "Preview — nothing saved yet"}</Txt>
          <KV k="Rows in file" v={res.rows} />
          <KV k="New units" v={res.create} testID="import-create-count" />
          <KV k="Units to update" v={res.update} testID="import-update-count" />
          <KV k="Skipped (reserved/sold)" v={res.skipped.length} />
          <KV k="Rows with errors" v={res.error_count} testID="import-error-count" />
          {[...res.errors.slice(0, 20).map((e: any) => ({ k: `Row ${e.row} ${e.unit}`, v: e.errors.join("; "), bad: true })),
            ...res.skipped.slice(0, 10).map((s: any) => ({ k: `Row ${s.row} ${s.unit}`, v: s.reason, bad: false }))].map((x, i) => (
            <Row key={i} style={{ alignItems: "flex-start", paddingVertical: 4 }}>
              <Icon name={x.bad ? "alert-circle" : "information-circle"} size={16} color={x.bad ? colors.error : colors.warning} />
              <Txt variant="caption" style={{ flex: 1 }}><Txt variant="caption" color={colors.onSurface}>{x.k}: </Txt>{x.v}</Txt>
            </Row>
          ))}
          {res.error_count > 0 && <Txt variant="caption" color={colors.error} style={{ marginTop: spacing.sm }}>Fix the errors and choose the file again. Nothing is imported while errors remain.</Txt>}
        </Card>
      )}
      {res && !res.imported && res.error_count === 0 && res.create + res.update > 0 && file && (
        <Btn title={`Import ${res.create + res.update} units`} icon="checkmark" testID="import-confirm-button" loading={busy} onPress={() => run(file, false)} />
      )}
      {res?.imported && <Btn title="Done" testID="import-done-button" onPress={close} />}
      <View style={{ height: spacing.sm }} />
    </Sheet>
  );
}
