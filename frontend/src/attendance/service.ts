/** Attendance service: API calls + optional location. Shared by the employee and admin screens. */
import { Platform } from "react-native";
import * as Location from "expo-location";

import { api, apiUpload } from "@/src/api";
import { confirmAsk } from "@/src/manage/helpers";

export type AttKind = "check_in" | "check_out";

/** Location is collected only when the org enabled it AND the employee agrees after an explanation. */
async function maybeLocation(enabled: boolean): Promise<{ lat: string; lng: string } | null> {
  if (!enabled) return null;
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      const ok = await confirmAsk("Add your location?", "Your organization records location with attendance. It's optional — you can still mark attendance without it.", "Allow");
      if (!ok) return null;
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Platform.OS === "web" ? Location.Accuracy.Balanced : Location.Accuracy.High });
    return { lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) };
  } catch {
    return null;
  }
}

export async function submitAttendance(kind: AttKind, photoUri: string, locationEnabled: boolean) {
  const loc = await maybeLocation(locationEnabled);
  return apiUpload(`/attendance/${kind === "check_in" ? "check-in" : "check-out"}`,
    { uri: photoUri, name: `${kind}-${Date.now()}.jpg`, mimeType: "image/jpeg" },
    { capture: "camera", ...(loc ?? {}) }, "photo");
}

export const requestException = (kind: AttKind, reason: string) => api("/attendance/exceptions", { body: { kind, reason } });

export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDuration = (m?: number | null) => (m === null || m === undefined ? "—" : `${Math.floor(m / 60)}h ${m % 60}m`);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const ym = (d: Date) => ymd(d).slice(0, 7);

export const STATUS_LABEL: Record<string, string> = {
  open: "Checked in", present: "Present", corrected: "Corrected", incomplete: "Incomplete", absent: "Absent", upcoming: "—",
};
