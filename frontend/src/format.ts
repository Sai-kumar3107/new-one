export function inr(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function inrFull(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const STAGES = ["new", "contacted", "site_visit_scheduled", "negotiation", "closed_won", "closed_lost"] as const;

export const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  site_visit_scheduled: "Site Visit",
  negotiation: "Negotiation",
  closed_won: "Won",
  closed_lost: "Lost",
};

export const ROLE_LABEL: Record<string, string> = {
  global_admin: "Global Admin",
  org_admin: "Org Admin",
  finance: "Finance",
  sales_exec: "Sales Executive",
  channel_partner: "Channel Partner",
};

export function sourceLabel(s?: string): string {
  const m: Record<string, string> = {
    facebook: "Meta Ads",
    google_ads: "Google Ads",
    magicbricks: "MagicBricks",
    "99acres": "99acres",
    justdial: "Justdial",
    website: "Website",
    whatsapp: "WhatsApp",
    channel_partner: "Channel Partner",
    referral: "Referral",
    manual: "Manual",
  };
  return m[s ?? ""] ?? (s || "—");
}

export const SOURCES = ["manual", "facebook", "google_ads", "magicbricks", "99acres", "justdial", "website", "whatsapp", "referral"];
