import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, fileUrl } from "@/src/api";
import { useToast } from "@/src/toast";
import { Btn, Field, KV, Row, Sheet, Txt } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { fmtDuration, fmtTime, STATUS_LABEL } from "@/src/attendance/service";

const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString() : null;
};

/** Admin: one attendance record — photos, correction form (reason mandatory) and correction history. */
export function RecordSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!recordId, queryKey: ["attendance", "detail", recordId], queryFn: () => api<any>(`/attendance/${recordId}/detail`) });
  const r = q.data;
  const [cin, setCin] = useState<string | null>(null);
  const [cout, setCout] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setCin(null); setCout(null); setReason(""); onClose(); };

  const save = async () => {
    const vin = cin ?? toLocalInput(r.check_in_at);
    const vout = cout ?? toLocalInput(r.check_out_at);
    const isoIn = fromLocalInput(vin);
    const isoOut = vout.trim() ? fromLocalInput(vout) : null;
    if (!isoIn || (vout.trim() && !isoOut)) return toast.show("Use the format YYYY-MM-DD HH:MM", "error");
    if (reason.trim().length < 5) return toast.show("A reason (at least 5 characters) is required", "error");
    setBusy(true);
    try {
      await api(`/attendance/${recordId}/correct`, { body: { check_in_at: isoIn, check_out_at: isoOut, reason: reason.trim() } });
      toast.show("Attendance corrected");
      qc.invalidateQueries({ queryKey: ["attendance"] });
      close();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const photo = (url: string | null, label: string, id: string) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Txt variant="caption">{label}</Txt>
      {url ? <Image testID={id} source={{ uri: fileUrl(url) }} style={{ width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }} contentFit="cover" />
        : <View style={{ aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}><Txt variant="caption">{r?.photos_purged ? "Deleted (retention)" : "No photo"}</Txt></View>}
    </View>
  );

  return (
    <Sheet visible={!!recordId} onClose={close} title={r ? `${r.user_name} · ${r.date}` : "Attendance"} testID="attendance-record-sheet">
      {r && (
        <>
          <Row style={{ gap: spacing.md, alignItems: "flex-start" }}>
            {photo(r.check_in_photo_url, `In · ${fmtTime(r.check_in_at)}`, "record-check-in-photo")}
            {photo(r.check_out_photo_url, `Out · ${fmtTime(r.check_out_at)}`, "record-check-out-photo")}
          </Row>
          <KV k="Status" v={STATUS_LABEL[r.status]} />
          <KV k="Worked" v={fmtDuration(r.duration_minutes)} />
          <KV k="Source" v={r.source === "exception" ? "Approved exception" : "Live camera"} />
          {r.check_in_lat !== null && <KV k="Check-in location" v={`${r.check_in_lat.toFixed(4)}, ${r.check_in_lng.toFixed(4)}`} />}
          <Txt variant="label" style={{ marginTop: spacing.sm }}>Correct this record</Txt>
          <Field label="Check in (YYYY-MM-DD HH:MM)" testID="correct-check-in-input" value={cin ?? toLocalInput(r.check_in_at)} onChangeText={setCin} />
          <Field label="Check out (leave empty if none)" testID="correct-check-out-input" value={cout ?? toLocalInput(r.check_out_at)} onChangeText={setCout} />
          <Field label="Reason *" testID="correct-reason-input" value={reason} onChangeText={setReason} placeholder="e.g. Forgot to check out, confirmed by manager" />
          <Btn title="Save correction" icon="create-outline" testID="correct-save-button" loading={busy} onPress={save} />
          {r.corrections.length > 0 && (
            <View style={{ gap: 6 }} testID="correction-history">
              <Txt variant="label">Correction history</Txt>
              {r.corrections.map((c: any) => (
                <Txt key={c.id} variant="caption">{new Date(c.created_at).toLocaleString("en-IN")} · {c.admin_name}: {c.reason} ({fmtTime(c.before.check_in_at)}–{fmtTime(c.before.check_out_at)} → {fmtTime(c.after.check_in_at)}–{fmtTime(c.after.check_out_at)})</Txt>
              ))}
            </View>
          )}
        </>
      )}
      <View style={{ height: spacing.sm }} />
    </Sheet>
  );
}
