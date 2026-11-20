import type { NewsSource, NewsSourceKind, NewsSourceStatus, Prisma, State } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError, type FieldError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { optionalText, parseUrl, requiredText } from "../reference/reference.schemas";
import { isSupportedKind } from "./adapters";
import { previewSource } from "./ingest";
import { enqueueFetchNow, syncNewsSchedules } from "./news.queue";

// Admin side of the news tool: the source registry (plan §15.7). Review of the notices
// themselves arrives in step N3.

type SourceWithState = NewsSource & { state: Pick<State, "id" | "name" | "code"> | null };
const withState = { state: { select: { id: true, name: true, code: true } } } as const;

const UNSUPPORTED = "Pages whose notices are filled in by JavaScript cannot be read yet. Use RSS, WordPress or HTML_LIST, or wait for the browser-based reader (step N5).";

export function toSourceDto(s: SourceWithState, counts?: { items: number; pending: number }) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    state: s.state,
    kind: s.kind,
    listUrl: s.listUrl,
    siteUrl: s.siteUrl,
    config: (s.config ?? {}) as Record<string, unknown>,
    isActive: s.isActive,
    fetchIntervalMin: s.fetchIntervalMin,
    notes: s.notes,
    canFetch: isSupportedKind(s.kind),
    status: s.status,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastItemCount: s.lastItemCount,
    consecutiveFailures: s.consecutiveFailures,
    consecutiveEmptyRuns: s.consecutiveEmptyRuns,
    lastError: s.lastError,
    baselineAt: s.baselineAt?.toISOString() ?? null,
    itemCount: counts?.items ?? 0,
    pendingCount: counts?.pending ?? 0,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function countsFor(ids: string[]) {
  const rows = ids.length ? await prisma.newsItem.groupBy({ by: ["sourceId", "status"], where: { sourceId: { in: ids } }, _count: { _all: true } }) : [];
  const out = new Map<string, { items: number; pending: number }>();
  for (const r of rows) {
    const c = out.get(r.sourceId) ?? { items: 0, pending: 0 };
    c.items += r._count._all;
    if (r.status === "PENDING") c.pending += r._count._all;
    out.set(r.sourceId, c);
  }
  return out;
}

/** Keeps the repeating jobs in step with an edit. A Redis problem must never make the edit itself fail. */
async function resync() {
  try {
    await syncNewsSchedules();
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "could not refresh news schedules; the worker will catch up within 10 minutes");
  }
}

async function loadSource(id: string): Promise<SourceWithState> {
  const s = await prisma.newsSource.findUnique({ where: { id }, include: withState });
  if (!s) throw AppError.notFound("News source not found.");
  return s;
}

export async function listSources(q: { kind?: NewsSourceKind; status?: NewsSourceStatus; stateId?: string; isActive?: boolean; q?: string }) {
  const search = q.q?.trim();
  const rows = await prisma.newsSource.findMany({
    where: {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.stateId ? { stateId: q.stateId } : {}),
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
    },
    include: withState,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const counts = await countsFor(rows.map((r) => r.id));
  return {
    items: rows.map((r) => toSourceDto(r, counts.get(r.id))),
    attentionCount: rows.filter((r) => r.isActive && r.status !== "OK").length,
  };
}

export async function getSource(id: string) {
  const s = await loadSource(id);
  return toSourceDto(s, (await countsFor([id])).get(id));
}

interface SourceInput {
  slug: string;
  name: string;
  stateId?: string | null;
  kind: NewsSourceKind;
  listUrl: string;
  siteUrl?: string | null;
  config?: Record<string, unknown>;
  isActive?: boolean;
  fetchIntervalMin?: number;
  notes?: string | null;
}

async function checkState(stateId: string | null | undefined, errors: FieldError[]) {
  if (!stateId) return;
  if (!(await prisma.state.findUnique({ where: { id: stateId }, select: { id: true } }))) errors.push({ path: "stateId", message: "That state does not exist." });
}

export async function createSource(actor: AuditActor, input: SourceInput) {
  const errors: FieldError[] = [];
  await checkState(input.stateId, errors);
  const isActive = input.isActive ?? false;
  if (isActive && !isSupportedKind(input.kind)) errors.push({ path: "isActive", message: UNSUPPORTED });
  if (await prisma.newsSource.findUnique({ where: { slug: input.slug }, select: { id: true } })) errors.push({ path: "slug", message: "Another source already uses this slug." });
  if (errors.length) throw AppError.invalid("Please fix the highlighted fields.", errors);

  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.newsSource.create({
      data: {
        slug: input.slug,
        name: requiredText("name", input.name),
        stateId: input.stateId ?? null,
        kind: input.kind,
        listUrl: parseUrl("listUrl", input.listUrl),
        siteUrl: input.siteUrl ? parseUrl("siteUrl", input.siteUrl) : null,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
        isActive,
        fetchIntervalMin: input.fetchIntervalMin ?? 180,
        notes: optionalText(input.notes) ?? null,
        createdById: actor.id,
      },
      include: withState,
    });
    await audit(tx, { actor, action: "news-source.create", entityType: "NewsSource", entityId: s.id, after: toSourceDto(s) });
    return s;
  });
  await resync();
  return toSourceDto(created);
}

export async function updateSource(actor: AuditActor, id: string, input: Partial<Omit<SourceInput, "slug">>) {
  const before = await loadSource(id);
  const errors: FieldError[] = [];
  await checkState(input.stateId, errors);
  const kind = input.kind ?? before.kind;
  const isActive = input.isActive ?? before.isActive;
  if (isActive && !isSupportedKind(kind)) errors.push({ path: input.kind !== undefined ? "kind" : "isActive", message: UNSUPPORTED });
  if (errors.length) throw AppError.invalid("Please fix the highlighted fields.", errors);

  // A different address or kind makes the stored change markers meaningless.
  const sourceMoved = (input.listUrl !== undefined && input.listUrl !== before.listUrl) || (input.kind !== undefined && input.kind !== before.kind);

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.newsSource.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: requiredText("name", input.name) } : {}),
        ...(input.stateId !== undefined ? { stateId: input.stateId } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.listUrl !== undefined ? { listUrl: parseUrl("listUrl", input.listUrl) } : {}),
        ...(input.siteUrl !== undefined ? { siteUrl: input.siteUrl ? parseUrl("siteUrl", input.siteUrl) : null } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.fetchIntervalMin !== undefined ? { fetchIntervalMin: input.fetchIntervalMin } : {}),
        ...(input.notes !== undefined ? { notes: optionalText(input.notes) ?? null } : {}),
        ...(sourceMoved || input.config !== undefined ? { etag: null, lastModified: null } : {}),
        // Re-enabling a source gives it a clean slate; the failure counters described the old settings.
        ...(input.isActive === true && !before.isActive ? { status: "OK" as const, consecutiveFailures: 0, consecutiveEmptyRuns: 0, lastError: null } : {}),
      },
      include: withState,
    });
    await audit(tx, { actor, action: "news-source.update", entityType: "NewsSource", entityId: id, before: toSourceDto(before), after: toSourceDto(s) });
    return s;
  });
  await resync();
  return toSourceDto(updated, (await countsFor([id])).get(id));
}

export async function deleteSource(actor: AuditActor, id: string) {
  const before = await loadSource(id);
  const items = await prisma.newsItem.count({ where: { sourceId: id } });
  if (items > 0) throw AppError.conflict(`This source has ${items} stored notice${items === 1 ? "" : "s"}. Switch it off instead of deleting it.`);
  await prisma.$transaction(async (tx) => {
    await tx.newsSource.delete({ where: { id } });
    await audit(tx, { actor, action: "news-source.delete", entityType: "NewsSource", entityId: id, before: toSourceDto(before) });
  });
  await resync();
}

/** Dry run: fetch and read the source as a real run would, store nothing. */
export async function testSource(id: string) {
  const s = await loadSource(id);
  return previewSource(s);
}

/** "Fetch now": queued for the worker; the answer comes back at once. */
export async function runSourceNow(id: string) {
  const s = await loadSource(id);
  if (!isSupportedKind(s.kind)) throw AppError.invalid(UNSUPPORTED, [{ path: "kind", message: UNSUPPORTED }]);
  try {
    await enqueueFetchNow(id);
  } catch (e) {
    logger.error({ err: (e as Error).message }, "could not queue a news fetch");
    throw new AppError(503, "SERVICE_UNAVAILABLE", "The job queue is not reachable right now. Try again in a minute.");
  }
}

export async function listRuns(id: string, limit = 30) {
  await loadSource(id);
  const rows = await prisma.newsFetchRun.findMany({ where: { sourceId: id }, orderBy: { startedAt: "desc" }, take: limit });
  return {
    items: rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.durationMs,
      outcome: r.outcome,
      httpStatus: r.httpStatus,
      itemsFound: r.itemsFound,
      itemsNew: r.itemsNew,
      error: r.error,
    })),
  };
}
