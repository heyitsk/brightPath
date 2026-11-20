import { env } from "../../config/env";

// The one place that talks to other people's servers (plan §15.6, "Politeness"):
// identifying User-Agent, robots.txt honoured, one request at a time per host with a minimum gap,
// a timeout, a size cap, and conditional requests so an unchanged page costs almost nothing.

export const USER_AGENT = `BrightPathNewsBot/1.0 (+reads public admission notices; contact: ${env.NEWS_CONTACT_EMAIL})`;
const BOT_NAME = "brightpathnewsbot";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ROBOTS_TTL_MS = 6 * 3600_000;

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  /** Staff opt-in for a site with a broken certificate chain. Off unless the source says so. */
  allowInsecureTls?: boolean;
  /** Ask for this kind of answer. JSON sources send `application/json`: some APIs answer in XML when the request also mentions XML. */
  accept?: string;
  /** Skip the robots.txt check (the check itself is the only caller that sets this). */
  skipRobots?: boolean;
}

export type FetchResult =
  | { kind: "ok"; status: number; body: string; url: string; etag: string | null; lastModified: string | null; contentType: string }
  | { kind: "not-modified"; status: 304; url: string }
  | { kind: "blocked-by-robots"; url: string }
  | { kind: "error"; status: number | null; url: string; message: string };

type FetchImpl = (url: string, init: RequestInit & { tls?: { rejectUnauthorized: boolean } }) => Promise<Response>;
let impl: FetchImpl = (url, init) => fetch(url, init);
/** Tests replace the network with canned responses. Pass nothing to restore the real one. */
export function setFetchImplementation(next?: FetchImpl) {
  impl = next ?? ((url, init) => fetch(url, init));
  robotsCache.clear();
}

/** Some older government sites are not UTF-8. Use the declared charset (header, then `<meta>`), falling back to UTF-8. */
export function decodeBody(bytes: ArrayBuffer, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---- one request at a time per host, with a gap ---------------------------------------

const hostQueue = new Map<string, Promise<unknown>>();
const lastRequestAt = new Map<string, number>();

async function politely<T>(host: string, job: () => Promise<T>): Promise<T> {
  const previous = hostQueue.get(host) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const wait = (lastRequestAt.get(host) ?? 0) + env.NEWS_MIN_HOST_DELAY_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await job();
      } finally {
        lastRequestAt.set(host, Date.now());
      }
    });
  hostQueue.set(host, run);
  return run;
}

// ---- robots.txt ------------------------------------------------------------------------

interface Rule {
  allow: boolean;
  path: string;
}
const robotsCache = new Map<string, { rules: Rule[]; at: number }>();

/** Rules of the most specific matching group (our name, else `*`). Lines that are not directives (an HTML error page) are ignored. */
export function parseRobots(text: string): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && BOT_NAME.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  return (mine ?? star)?.rules ?? [];
}

/** Longest matching rule wins; allow beats disallow on a tie; no match means allowed. */
export function robotsAllows(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    if (!new RegExp(`^${pattern}`).test(pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

async function robotsFor(origin: string, options: FetchOptions): Promise<Rule[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) return cached.rules;
  let rules: Rule[] = [];
  try {
    const res = await request(`${origin}/robots.txt`, { ...options, skipRobots: true, etag: null, lastModified: null });
    if (res.kind === "ok" && res.status === 200) rules = parseRobots(res.body);
  } catch {
    // An unreachable robots.txt means "no restrictions", the usual convention.
  }
  robotsCache.set(origin, { rules, at: Date.now() });
  return rules;
}

// ---- the request ------------------------------------------------------------------------

async function request(url: string, options: FetchOptions): Promise<FetchResult> {
  const host = new URL(url).host;
  return politely(host, async () => {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: options.accept ?? "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.5" };
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.lastModified) headers["if-modified-since"] = options.lastModified;
    try {
      const res = await impl(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(env.NEWS_FETCH_TIMEOUT_MS),
        ...(options.allowInsecureTls ? { tls: { rejectUnauthorized: false } } : {}),
      });
      if (res.status === 304) return { kind: "not-modified", status: 304, url };
      if (!res.ok) return { kind: "error", status: res.status, url, message: `The site answered HTTP ${res.status}.` };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BODY_BYTES) return { kind: "error", status: res.status, url, message: "The page is larger than 5 MB, so it was not read." };
      const bytes = await res.arrayBuffer();
      const body = decodeBody(bytes, res.headers.get("content-type") ?? "");
      if (bytes.byteLength > MAX_BODY_BYTES) return { kind: "error", status: res.status, url, message: "The page is larger than 5 MB, so it was not read." };
      return {
        kind: "ok",
        status: res.status,
        body,
        url: res.url || url,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        contentType: res.headers.get("content-type") ?? "",
      };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      const code = err.cause?.code;
      const message =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? `The site did not answer within ${Math.round(env.NEWS_FETCH_TIMEOUT_MS / 1000)} seconds.`
          : code === "ENOTFOUND" || code === "ConnectionRefused"
            ? "The site could not be reached (address not found or refused)."
            : `The request failed: ${code ?? err.message}`;
      return { kind: "error", status: null, url, message };
    }
  });
}

/** Fetch one page or feed, politely. Never throws: failures come back as `kind: "error"`. */
export async function politeFetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "error", status: null, url, message: "The address is not a valid URL." };
  }
  if (!options.skipRobots) {
    const rules = await robotsFor(parsed.origin, options);
    if (!robotsAllows(rules, parsed.pathname + parsed.search)) return { kind: "blocked-by-robots", url };
  }
  return request(url, options);
}
