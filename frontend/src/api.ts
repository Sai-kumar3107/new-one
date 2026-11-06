import { Linking } from "react-native";

import { storage } from "@/src/utils/storage";
import { LocalFile, uploadForm } from "@/src/utils/upload";

export const API_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const TOKEN_KEY = "auth_token";

let memToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  memToken = t || null;
  return memToken;
}

export async function setToken(t: string | null) {
  memToken = t;
  if (t) await storage.secureSet(TOKEN_KEY, t);
  else await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return handle<T>(res, token);
}

async function handle<T>(res: { ok: boolean; status: number; json: () => Promise<any> }, token: string | null): Promise<T> {
  if (!res.ok) {
    let msg = "Something went wrong";
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail[0]?.msg ?? msg : msg;
    } catch {}
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

/** Multipart upload of one file (field "file") plus text fields, with auth. */
export async function apiUpload<T = any>(path: string, file: LocalFile, fields: Record<string, string> = {}, fieldName = "file"): Promise<T> {
  const token = await getToken();
  const res = await uploadForm(`${API_URL}${path}`, { files: { [fieldName]: file }, fields, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return handle<T>(res, token);
}

/** Backend file links are relative ("/api/files/..."); make them absolute for <Image> and the browser. */
export const fileUrl = (u?: string | null) => (u && u.startsWith("/api") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${u}` : u ?? undefined);

export const openFile = (u?: string | null) => {
  const url = fileUrl(u);
  if (url) Linking.openURL(url).catch(() => {});
};
