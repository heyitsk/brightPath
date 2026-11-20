import type { NewsDateBasis, NewsItemStatus, NewsRunOutcome, NewsSource, NewsSourceStatus } from "../../generated/prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { adapterFor, AdapterError, type Candidate } from "./adapters";
import { defaultWpApiUrl } from "./adapters/wp-rest";
import { politeFetch } from "./fetcher";
import { classify, titleKey } from "./relevance";
import { urlHash } from "./url";
import { getSetting } from "../site/site.service";
import { audit } from "../../lib/audit";

// Fetch one source, find its notices, store the new ones as candidates, and keep the source's
// health up to date (plan §15.5 steps 1 to 5, §15.6).

/** First read of a source: keep at most this many of the newest notices, and none older than the age limit (D-138). */
export const BASELINE_KEEP = 20;
export const BASELINE_MAX_AGE_DAYS = 60;
/** A later run that finds more new notices than this is treated like a first read: the site was probably reorganised. */
export const FLOOD_LIMIT = 30;

export const DEGRADED_AFTER_FAILURES = 3;
export const BROKEN_AFTER_FAILURES = 10;
export const BROKEN_AFTER_EMPTY_RUNS = 3;

// ---- pure rules (unit-tested) -----------------------------------------------------------

/** PENDING for the newest recent notices, BASELINE for the rest. `index` is the position in the source's own order (newest first). */
export function baselineStatus(candidate: Candidate, index: number, now: Date): Extract<NewsItemStatus, "PENDING" | "BASELINE"> {
  if (index >= BASELINE_KEEP) return "BASELINE";
  const d = candidate.sourcePublishedAt;
  if (d && d.getTime() < now.getTime() - BASELINE_MAX_AGE_DAYS * 86_400_000) return "BASELINE";
  return "PENDING";
}

export interface HealthState {
  consecutiveFailures: number;
  consecutiveEmptyRuns: number;
  lastItemCount: number;
}
export type RunResult = { ok: false } | { ok: true; found: number; notModified?: boolean };

export function nextHealth(prev: HealthState, run: RunResult): HealthState & { status: NewsSourceStatus } {
  let { consecutiveFailures, consecutiveEmptyRuns, lastItemCount } = prev;
  if (!run.ok) {
    consecutiveFailures += 1;
  } else {
    consecutiveFailures = 0;
    if (!run.notModified) {
      if (run.found > 0) {
        consecutiveEmptyRuns = 0;
        lastItemCount = run.found;
      } else if (lastItemCount > 0) {
        consecutiveEmptyRuns += 1; // it used to return notices and now returns none: usually a changed layout
      }
    }
  }
  const status: NewsSourceStatus =
    consecutiveFailures >= BROKEN_AFTER_FAILURES || consecutiveEmptyRuns >= BROKEN_AFTER_EMPTY_RUNS
      ? "BROKEN"
      : consecutiveFailures >= DEGRADED_AFTER_FAILURES
        ? "DEGRADED"
        : "OK";
  return { consecutiveFailures, consecutiveEmptyRuns, lastItemCount, status };
}

// ---- fetch and extract ------------------------------------------------------------------

/** The address actually requested. A WordPress source may give just the site's home page; the API address is then derived. */
export function requestUrl(source: Pick<NewsSource, "kind" | "listUrl" | "config">): string {
  const config = (source.config ?? {}) as Record<string, unknown>;
  if (source.kind === "WP_REST") {
    if (typeof config.apiUrl === "string" && config.apiUrl) return config.apiUrl;
    return source.listUrl.includes("/wp-json/") ? source.listUrl : defaultWpApiUrl(source.listUrl);
  }
  return source.listUrl;
}

export type Extraction =
  | { ok: true; httpStatus: number; candidates: Candidate[]; etag: string | null; lastModified: string | null; notModified: false }
  | { ok: true; httpStatus: 304; candidates: []; etag: null; lastModified: null; notModified: true }
  | { ok: false; outcome: Extract<NewsRunOutcome, "ERROR" | "BLOCKED_BY_ROBOTS">; httpStatus: number | null; error: string };

export async function fetchAndExtract(source: NewsSource, opts: { conditional: boolean; now?: Date }): Promise<Extraction> {
  const adapter = adapterFor(source.kind);
  if (!adapter) {
    return { ok: false, outcome: "ERROR", httpStatus: null, error: `Sources of kind ${source.kind} cannot be read yet (that reader is built in a later step).` };
  }
  const config = (source.config ?? {}) as Record<string, unknown>;
  const url = requestUrl(source);
  const res = await politeFetch(url, {
    etag: opts.conditional ? source.etag : null,
    lastModified: opts.conditional ? source.lastModified : null,
    allowInsecureTls: config.allowInsecureTls === true,
  });
  if (res.kind === "blocked-by-robots") return { ok: false, outcome: "BLOCKED_BY_ROBOTS", httpStatus: null, error: "The site's robots.txt does not allow reading this page." };
  if (res.kind === "error") return { ok: false, outcome: "ERROR", httpStatus: res.status, error: res.message };
  if (res.kind === "not-modified") return { ok: true, httpStatus: 304, candidates: [], etag: null, lastModified: null, notModified: true };
  try {
    const candidates = adapter({ body: res.body, url: res.url, config, now: opts.now ?? new Date() });
    return { ok: true, httpStatus: res.status, candidates, etag: res.etag, lastModified: res.lastModified, notModified: false };
  } catch (e) {
    if (e instanceof AdapterError) return { ok: false, outcome: "ERROR", httpStatus: res.status, error: e.message };
    throw e;
  }
}

/** Remove repeats within one read (same address listed twice), keeping the first (newest). */
function uniqueByHash(candidates: Candidate[]) {
  const seen = new Set<string>();
  const out: Array<{ candidate: Candidate; hash: string; index: number }> = [];
  candidates.forEach((candidate, index) => {
    const hash = urlHash(candidate.url);
    if (seen.has(hash)) return;
    seen.add(hash);
    out.push({ candidate, hash, index });
  });
  return out;
}

// ---- relevance, repeats and health changes (step N4) ----------------------------------------

/** Notices with the same title seen in the last 120 days count as repeats (the same notice on another page, or re-posted). */
const REPEAT_WINDOW_DAYS = 120;

export async function relevanceThreshold(): Promise<number> {
  const v = await getSetting<number>("news.relevanceThreshold");
  return Number.isInteger(v) && v >= 1 ? v : 3;
}

/**
 * Decide what each new notice becomes. Relevance comes first, so that the first-read limit counts only
 * relevant notices ("the newest 20" means the newest 20 that matter, not 20 of which 18 are PG). A notice
 * that is not relevant goes to FILTERED, or to BASELINE if it is also too old to matter.
 */
export function planStatuses<T extends { candidate: Candidate; index: number }>(
  fresh: T[],
  threshold: number,
  limit: boolean,
  now: Date,
): Array<T & { cls: ReturnType<typeof classify>; status: NewsItemStatus }> {
  const classified = fresh.map((f) => ({ ...f, cls: classify(f.candidate.title, { threshold }) }));
  let relevantIndex = 0;
  return classified.map((c) => {
    if (!c.cls.relevant) {
      const old = c.candidate.sourcePublishedAt && c.candidate.sourcePublishedAt.getTime() < now.getTime() - BASELINE_MAX_AGE_DAYS * 86_400_000;
      return { ...c, status: limit && old ? ("BASELINE" as const) : ("FILTERED" as const) };
    }
    const status = limit ? baselineStatus(c.candidate, relevantIndex, now) : ("PENDING" as const);
    relevantIndex++;
    return { ...c, status };
  });
}

/** For each new notice, the id of an earlier notice with the same title, if there is one. Also finds repeats inside the same batch. */
async function findRepeats(rows: Array<{ id: string; key: string }>, now: Date): Promise<Map<string, string>> {
  const keys = [...new Set(rows.map((r) => r.key).filter(Boolean))];
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 86_400_000);
  const earlier = keys.length
    ? await prisma.newsItem.findMany({ where: { titleKey: { in: keys }, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { id: true, titleKey: true } })
    : [];
  const firstByKey = new Map<string, string>();
  for (const e of earlier) if (!firstByKey.has(e.titleKey)) firstByKey.set(e.titleKey, e.id);
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.key) continue;
    const first = firstByKey.get(r.key);
    if (first) out.set(r.id, first);
    else firstByKey.set(r.key, r.id); // the first of its kind in this batch
  }
  return out;
}

/** A source going bad, or coming back, is written to the audit log (and the server log) so it cannot pass unnoticed. Email alerts arrive with the email service (Phase 6). */
async function recordHealthChange(source: NewsSource, to: NewsSourceStatus, detail: { lastError: string | null; consecutiveFailures: number; consecutiveEmptyRuns: number }) {
  if (source.status === to) return;
  const action = to === "BROKEN" ? "news-source.broken" : to === "DEGRADED" && source.status === "OK" ? "news-source.degraded" : to === "OK" ? "news-source.recovered" : null;
  if (!action) return;
  logger[to === "BROKEN" ? "error" : "warn"]({ source: source.slug, from: source.status, to, ...detail }, "news source health changed");
  await audit(prisma, { actor: null, action, entityType: "NewsSource", entityId: source.id, before: { status: source.status }, after: { status: to, ...detail } });
}

// ---- a real run -------------------------------------------------------------------------

export interface RunSummary {
  outcome: NewsRunOutcome;
  httpStatus: number | null;
  itemsFound: number;
  itemsNew: number;
  error: string | null;
  durationMs: number;
}

/** One scheduled (or manual) fetch of one source. Records the run, the new notices and the source's health. */
export async function runSource(sourceId: string, now = new Date()): Promise<RunSummary> {
  const source = await prisma.newsSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`news source ${sourceId} not found`);
  const started = Date.now();
  const extraction = await fetchAndExtract(source, { conditional: true, now });
  const durationMs = Date.now() - started;

  if (!extraction.ok) {
    const health = nextHealth(source, { ok: false });
    await prisma.$transaction([
      prisma.newsFetchRun.create({ data: { sourceId, durationMs, outcome: extraction.outcome, httpStatus: extraction.httpStatus, error: extraction.error } }),
      prisma.newsSource.update({ where: { id: sourceId }, data: { ...health, lastRunAt: now, lastError: extraction.error } }),
    ]);
    logger.warn({ source: source.slug, status: health.status, error: extraction.error }, "news fetch failed");
    await recordHealthChange(source, health.status, { lastError: extraction.error, consecutiveFailures: health.consecutiveFailures, consecutiveEmptyRuns: health.consecutiveEmptyRuns });
    return { outcome: extraction.outcome, httpStatus: extraction.httpStatus, itemsFound: 0, itemsNew: 0, error: extraction.error, durationMs };
  }

  if (extraction.notModified) {
    const health = nextHealth(source, { ok: true, found: 0, notModified: true });
    await prisma.$transaction([
      prisma.newsFetchRun.create({ data: { sourceId, durationMs, outcome: "NOT_MODIFIED", httpStatus: 304 } }),
      prisma.newsSource.update({ where: { id: sourceId }, data: { ...health, lastRunAt: now, lastSuccessAt: now, lastError: null } }),
    ]);
    return { outcome: "NOT_MODIFIED", httpStatus: 304, itemsFound: 0, itemsNew: 0, error: null, durationMs };
  }

  const unique = uniqueByHash(extraction.candidates);
  const existing = unique.length
    ? await prisma.newsItem.findMany({ where: { sourceId, urlHash: { in: unique.map((u) => u.hash) } }, select: { urlHash: true } })
    : [];
  const known = new Set(existing.map((e) => e.urlHash));
  const fresh = unique.filter((u) => !known.has(u.hash));

  const isFirstRead = source.baselineAt === null;
  const threshold = await relevanceThreshold();
  const relevantFresh = fresh.filter((f) => classify(f.candidate.title, { threshold }).relevant);
  const flood = !isFirstRead && relevantFresh.length > FLOOD_LIMIT;
  if (flood) logger.warn({ source: source.slug, fresh: relevantFresh.length }, "news source returned a flood of new notices; keeping only the newest");
  const planned = planStatuses(fresh, threshold, isFirstRead || flood, now);

  const rows = planned.map((p) => ({ ...p, id: Bun.randomUUIDv7(), key: titleKey(p.candidate.title) }));
  const repeats = await findRepeats(rows, now);
  const created = rows.length
    ? await prisma.newsItem.createMany({
        data: rows.map(({ id, key, candidate, hash, cls, status }) => ({
          id,
          sourceId,
          stateId: source.stateId,
          title: candidate.title,
          originalUrl: candidate.url,
          urlHash: hash,
          titleKey: key,
          duplicateOfId: repeats.get(id) ?? null,
          snippet: candidate.snippet ?? null,
          sourcePublishedAt: candidate.sourcePublishedAt,
          dateBasis: candidate.dateBasis,
          firstSeenAt: now,
          relevanceScore: cls.score,
          relevanceReasons: cls.reasons,
          category: cls.category,
          status,
        })),
        skipDuplicates: true, // a second run racing this one must not fail on the unique key
      })
    : { count: 0 };

  const found = unique.length;
  const health = nextHealth(source, { ok: true, found });
  await prisma.$transaction([
    prisma.newsFetchRun.create({ data: { sourceId, durationMs, outcome: "OK", httpStatus: extraction.httpStatus, itemsFound: found, itemsNew: created.count } }),
    prisma.newsSource.update({
      where: { id: sourceId },
      data: {
        ...health,
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
        etag: extraction.etag,
        lastModified: extraction.lastModified,
        // The baseline is recorded only once something was actually found, so a source whose
        // selectors were wrong on day one still gets its proper first read later.
        ...(isFirstRead && found > 0 ? { baselineAt: now } : {}),
      },
    }),
  ]);
  await recordHealthChange(source, health.status, { lastError: null, consecutiveFailures: health.consecutiveFailures, consecutiveEmptyRuns: health.consecutiveEmptyRuns });
  return { outcome: "OK", httpStatus: extraction.httpStatus, itemsFound: found, itemsNew: created.count, error: null, durationMs };
}

// ---- dry run (admin "Test this source" and the probe script) ------------------------------

export interface PreviewResult {
  ok: boolean;
  error: string | null;
  httpStatus: number | null;
  requestedUrl: string;
  itemsFound: number;
  /** Not yet stored for this source. */
  itemsNew: number;
  items: Array<{ title: string; url: string; sourcePublishedAt: string | null; dateBasis: NewsDateBasis; snippet: string | null; isNew: boolean; relevant: boolean; score: number; category: string; reasons: string[] }>;
}

/** Fetch and read a source exactly as a real run would, but store nothing and change no health. */
export async function previewSource(source: NewsSource, limit = 30): Promise<PreviewResult> {
  const requestedUrl = requestUrl(source);
  const extraction = await fetchAndExtract(source, { conditional: false });
  if (!extraction.ok) return { ok: false, error: extraction.error, httpStatus: extraction.httpStatus, requestedUrl, itemsFound: 0, itemsNew: 0, items: [] };
  const unique = uniqueByHash(extraction.candidates);
  const existing = unique.length
    ? await prisma.newsItem.findMany({ where: { sourceId: source.id, urlHash: { in: unique.map((u) => u.hash) } }, select: { urlHash: true } })
    : [];
  const known = new Set(existing.map((e) => e.urlHash));
  const threshold = await relevanceThreshold();
  const items = unique.slice(0, limit).map(({ candidate, hash }) => {
    const cls = classify(candidate.title, { threshold });
    return {
      title: candidate.title,
      url: candidate.url,
      sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
      dateBasis: candidate.dateBasis,
      snippet: candidate.snippet ?? null,
      isNew: !known.has(hash),
      relevant: cls.relevant,
      score: cls.score,
      category: cls.category,
      reasons: cls.reasons,
    };
  });
  return { ok: true, error: null, httpStatus: extraction.httpStatus, requestedUrl, itemsFound: unique.length, itemsNew: unique.filter((u) => !known.has(u.hash)).length, items };
}

/** Housekeeping: fetch-run rows older than 30 days are removed (plan §15.4). */
export async function pruneFetchRuns(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const { count } = await prisma.newsFetchRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
  return count;
}
