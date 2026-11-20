import { createHash } from "node:crypto";

// Addresses are the identity of a notice (one stored copy per source), so two spellings of the
// same address must come out identical.

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i;

/** Absolute http(s) address without fragment, tracking parameters or a trailing-slash difference; null if unusable. */
export function normalizeUrl(raw: string, base?: string): string | null {
  // An empty value would resolve to the base address itself and look like a real notice.
  if (!raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

export const urlHash = (normalized: string) => createHash("sha256").update(normalized).digest("hex");
