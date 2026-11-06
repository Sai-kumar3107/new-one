import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn, EmptyState, Icon, Pressy, Row, Txt } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

/**
 * Live camera capture for attendance (platform-specific part, kept separate from business logic).
 * Native: expo-camera. Web: expo-camera uses the browser's getUserMedia, which requires HTTPS.
 * There is deliberately NO gallery / file option — attendance photos must be taken live.
 */
export function LiveCapture({ visible, title, onCancel, onConfirm, onUnavailable }: {
  visible: boolean; title: string; onCancel: () => void; onConfirm: (uri: string) => Promise<void> | void; onUnavailable: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insecureWeb = Platform.OS === "web" && typeof window !== "undefined" && !window.isSecureContext;

  const close = () => { setShot(null); setReady(false); setError(null); onCancel(); };
  const take = async () => {
    try {
      const p = await cam.current?.takePictureAsync({ quality: 0.6, skipProcessing: Platform.OS === "android" });
      if (p?.uri) setShot(p.uri);
    } catch {
      setError("Could not capture a photo. Try again.");
    }
  };
  const confirm = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      await onConfirm(shot);
      setShot(null);
      setReady(false);
    } finally {
      setBusy(false);
    }
  };

  const blocked = (sub: string, settings: boolean) => (
    <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
      <EmptyState icon="camera-outline" title="Camera unavailable" sub={sub} testID="capture-unavailable" />
      {settings && <Btn title="Open Settings" icon="settings-outline" testID="capture-open-settings" onPress={() => Linking.openSettings()} />}
      <Btn title="Request an exception" variant="secondary" icon="help-buoy-outline" testID="capture-request-exception" onPress={() => { close(); onUnavailable(); }} />
    </View>
  );

  let body: React.ReactNode;
  if (insecureWeb) body = blocked("Your browser only allows the camera on a secure (https) page.", false);
  else if (!perm) body = <ActivityIndicator style={{ flex: 1 }} color={colors.onSurface} />;
  else if (!perm.granted) {
    body = perm.canAskAgain ? (
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
        <EmptyState icon="camera-outline" title="Allow camera for attendance" sub="We take one live photo when you check in or out. Your admin can review it; it is deleted after the retention period." testID="capture-permission-explainer" />
        <Btn title="Allow camera" icon="camera" testID="capture-allow-camera" onPress={() => requestPerm()} />
        <Btn title="I can't use the camera" variant="ghost" testID="capture-cant-use" onPress={() => { close(); onUnavailable(); }} />
      </View>
    ) : blocked("Camera access is turned off for RCortexa. Enable it in Settings, or ask your admin for an exception.", Platform.OS !== "web");
  } else if (shot) {
    body = (
      <View style={{ flex: 1 }}>
        <Image source={{ uri: shot }} style={{ flex: 1 }} contentFit="cover" testID="capture-preview" />
        <Row style={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.lg }}>
          <Btn title="Retake" variant="secondary" icon="refresh" style={{ flex: 1 }} testID="capture-retake" onPress={() => setShot(null)} />
          <Btn title="Confirm" icon="checkmark" style={{ flex: 1 }} testID="capture-confirm" loading={busy} onPress={confirm} />
        </Row>
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        <CameraView ref={cam} style={{ flex: 1 }} facing="front" mirror onCameraReady={() => setReady(true)}
          onMountError={() => setError("This device's camera could not be started.")} testID="capture-camera" />
        {error && <Txt variant="caption" color={colors.error} style={{ textAlign: "center", padding: spacing.sm }}>{error}</Txt>}
        <View style={{ alignItems: "center", padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.sm }}>
          <Pressy testID="capture-shutter" disabled={!ready} onPress={take} accessibilityLabel="Take photo"
            style={[s.shutter, { borderColor: colors.onSurface, opacity: ready ? 1 : 0.4 }]}>
            <View style={[s.shutterInner, { backgroundColor: colors.onSurface }]} />
          </Pressy>
          {error && <Btn small title="Request an exception" variant="ghost" testID="capture-error-exception" onPress={() => { close(); onUnavailable(); }} />}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <Row style={{ padding: spacing.lg, justifyContent: "space-between" }}>
          <Txt variant="h3">{title}</Txt>
          <Pressy testID="capture-close" onPress={close} hitSlop={12}><Icon name="close" size={24} color={colors.onSurface} /></Pressy>
        </Row>
        {body}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 54, height: 54, borderRadius: 27 },
});
