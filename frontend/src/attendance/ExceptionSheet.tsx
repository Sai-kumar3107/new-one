import { useState } from "react";
import { View } from "react-native";

import { useToast } from "@/src/toast";
import { Btn, Chip, Field, Row, Sheet, Txt } from "@/src/ui";
import { spacing } from "@/src/theme";
import { AttKind, requestException } from "@/src/attendance/service";

/** Employee asks the admin to record attendance when the camera can't be used. */
export function ExceptionSheet({ visible, initialKind, onClose, onSent }: { visible: boolean; initialKind: AttKind; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<AttKind>(initialKind);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (reason.trim().length < 5) return toast.show("Please describe the problem (at least 5 characters)", "error");
    setBusy(true);
    try {
      await requestException(kind, reason.trim());
      toast.show("Request sent to your admin");
      setReason("");
      onSent();
      onClose();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Attendance exception" testID="exception-sheet">
      <Txt variant="caption">Your admin will review this. If approved, the time you send this request is recorded — no photo is attached.</Txt>
      <Row style={{ gap: spacing.sm }}>
        <Chip label="Check in" selected={kind === "check_in"} onPress={() => setKind("check_in")} testID="exception-kind-check_in" />
        <Chip label="Check out" selected={kind === "check_out"} onPress={() => setKind("check_out")} testID="exception-kind-check_out" />
      </Row>
      <Field label="What's wrong?" testID="exception-reason-input" value={reason} onChangeText={setReason} multiline placeholder="e.g. Phone camera is broken"
        style={{ height: 90, paddingTop: spacing.md, textAlignVertical: "top" }} />
      <Btn title="Send request" icon="send" testID="exception-send-button" loading={busy} onPress={send} />
      <View style={{ height: spacing.sm }} />
    </Sheet>
  );
}
