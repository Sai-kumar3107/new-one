import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

/** Cross-platform yes/no confirmation (window.confirm on web, native alert on phones). */
export function confirmAsk(title: string, message: string, okLabel = "Confirm", destructive = false): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

/** Photo-library permission flow: explain → ask → offer Settings when permanently denied. */
export async function ensureLibraryPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) {
    const open = await confirmAsk("Photo access is off", "Allow photo access in Settings to add project photos and floor plans.", "Open Settings");
    if (open) Linking.openSettings();
    return false;
  }
  const go = await confirmAsk("Add photos", "RCortexa needs access to your photos so you can upload project images.", "Continue");
  if (!go) return false;
  const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (res.granted) return true;
  if (!res.canAskAgain) {
    const open = await confirmAsk("Photo access denied", "You can enable photo access anytime in Settings.", "Open Settings");
    if (open) Linking.openSettings();
  }
  return false;
}

export async function pickImages(multiple = true) {
  if (!(await ensureLibraryPermission())) return [];
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: multiple, selectionLimit: 10, quality: 0.8 });
  if (r.canceled) return [];
  return r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg" }));
}

export const lakh = (v: string) => (v.trim() ? Math.round(Number(v) * 1e5) : null);
export const num = (v: string) => (v.trim() ? Number(v) : null);
export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const PROJECT_STATUSES = ["active", "upcoming", "completed"];
export const PROJECT_TYPES = ["residential", "commercial", "mixed_use", "plots", "villas"];
export const UNIT_TYPES = ["apartment", "villa", "plot", "office", "shop", "penthouse"];
export const FACINGS = ["North", "East", "South", "West", "North-East", "North-West", "South-East", "South-West"];
