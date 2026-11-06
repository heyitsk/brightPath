export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  maxAgeSec: number;
  secure: boolean;
}

/** httpOnly + SameSite=Lax session cookie. `Secure` only over HTTPS (production). */
export function serializeSessionCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${opts.maxAgeSec}`];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearSessionCookie = (name: string, secure: boolean) => serializeSessionCookie(name, "", { maxAgeSec: 0, secure });
