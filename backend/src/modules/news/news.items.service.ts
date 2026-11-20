import type { NewsCategory, NewsItem, NewsItemStatus, Prisma } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError, type FieldError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { slugifyShort } from "../../lib/slug";
import { optionalText } from "../reference/reference.schemas";

// The review queue and the public News page (plan §15.5 steps 5 to 7). Staff look at a fetched
// notice, check it against the official page, write a short summary, and publish it. Nothing is
// published by itself (D-134); published items link to the official original (D-139).

const include = {
  source: { select: { id: true, slug: true, name: true, siteUrl: true, kind: true } },
  state: { select: { id: true, name: true, code: true, slug: true } },
  duplicateOf: { select: { id: true, title: true, status: true } },
} satisfies Prisma.NewsItemInclude;
type ItemRow = Prisma.NewsItemGetPayload<{ include: typeof include }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

async function staffNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await prisma.staffUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function toDtos(rows: ItemRow[]) {
  const names = await staffNames(rows.flatMap((r) => [r.reviewedById, r.publishedById]));
  const person = (id: string | null) => (id ? { id, name: names.get(id) ?? "Former staff member" } : null);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    title: r.title,
    publicTitle: r.publicTitle,
    summary: r.summary,
    snippet: r.snippet,
    originalUrl: r.originalUrl,
    category: r.category,
    isPinned: r.isPinned,
    slug: r.slug,
    state: r.state ? { id: r.state.id, name: r.state.name, code: r.state.code } : null,
    source: r.source,
    sourcePublishedAt: iso(r.sourcePublishedAt),
    dateBasis: r.dateBasis,
    firstSeenAt: r.firstSeenAt.toISOString(),
    relevance: { score: r.relevanceScore, reasons: r.relevanceReasons },
    duplicateOf: r.duplicateOf,
    reviewedBy: person(r.reviewedById),
    reviewedAt: iso(r.reviewedAt),
    publishedBy: person(r.publishedById),
    publishedAt: iso(r.publishedAt),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function loadItem(id: string): Promise<ItemRow> {
  const row = await prisma.newsItem.findUnique({ where: { id }, include });
  if (!row) throw AppError.notFound("News item not found.");
  return row;
}

const ALL_STATUSES: NewsItemStatus[] = ["PENDING", "FILTERED", "PUBLISHED", "REJECTED", "UNPUBLISHED", "BASELINE"];

// ---- listing ---------------------------------------------------------------------------------------------

export interface ItemFilters {
  status?: NewsItemStatus;
  stateId?: string;
  central?: boolean;
  sourceId?: string;
  category?: NewsCategory;
  q?: string;
  hideRepeats?: boolean;
  limit?: number;
  cursor?: string;
}

/** Newest found first; the cursor is the found time and id of the last row, so rows decided meanwhile never shift the next page. */
function encodeCursor(r: { firstSeenAt: Date; id: string }) {
  return Buffer.from(`${r.firstSeenAt.toISOString()}|${r.id}`).toString("base64url");
}
function decodeCursor(cursor: string): { at: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || Number.isNaN(d.getTime())) throw AppError.invalid("That page marker is not valid.", [{ path: "cursor", message: "Use the nextCursor value from the previous page." }]);
  return { at: d, id };
}

function baseWhere(f: ItemFilters): Prisma.NewsItemWhereInput {
  const q = f.q?.trim();
  return {
    ...(f.stateId ? { stateId: f.stateId } : {}),
    ...(f.central ? { stateId: null } : {}),
    ...(f.sourceId ? { sourceId: f.sourceId } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.hideRepeats ? { duplicateOfId: null } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { publicTitle: { contains: q, mode: "insensitive" } }] } : {}),
  };
}

export async function listItems(f: ItemFilters) {
  const limit = f.limit ?? 25;
  const status = f.status ?? "PENDING";
  const where: Prisma.NewsItemWhereInput = { ...baseWhere(f), status };
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    where.AND = [{ OR: [{ firstSeenAt: { lt: c.at } }, { firstSeenAt: c.at, id: { lt: c.id } }] }];
  }
  const [rows, grouped] = await Promise.all([
    prisma.newsItem.findMany({ where, include, orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }], take: limit + 1 }),
    prisma.newsItem.groupBy({ by: ["status"], where: baseWhere(f), _count: { _all: true } }),
  ]);
  const page = rows.slice(0, limit);
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0])) as Record<NewsItemStatus, number>;
  return { items: await toDtos(page), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null, counts };
}

export async function getItem(id: string) {
  return (await toDtos([await loadItem(id)]))[0]!;
}

// ---- editing and decisions ----------------------------------------------------------------------------

export interface ItemEdit {
  publicTitle?: string | null;
  summary?: string | null;
  category?: NewsCategory;
  stateId?: string | null;
  isPinned?: boolean;
}

async function checkState(stateId: string | null | undefined, errors: FieldError[]) {
  if (stateId && !(await prisma.state.findUnique({ where: { id: stateId }, select: { id: true } }))) errors.push({ path: "stateId", message: "That state does not exist." });
}

function editData(input: ItemEdit): Prisma.NewsItemUncheckedUpdateInput {
  return {
    ...(input.publicTitle !== undefined ? { publicTitle: optionalText(input.publicTitle) ?? null } : {}),
    ...(input.summary !== undefined ? { summary: optionalText(input.summary) ?? null } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.stateId !== undefined ? { stateId: input.stateId } : {}),
    ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
  };
}

/** Edit wording, category, state or pin. Counts as a review (so re-scoring leaves it alone); on a published item the "checked on" date moves. */
export async function updateItem(actor: AuditActor, id: string, input: ItemEdit) {
  const before = await loadItem(id);
  const errors: FieldError[] = [];
  await checkState(input.stateId, errors);
  const summary = input.summary !== undefined ? (optionalText(input.summary) ?? null) : before.summary;
  if (before.status === "PUBLISHED" && !summary) errors.push({ path: "summary", message: "A published notice needs its summary. Unpublish it first to remove the summary." });
  if (errors.length) throw AppError.invalid("Please fix the highlighted fields.", errors);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.newsItem.update({ where: { id }, data: { ...editData(input), reviewedById: actor.id, reviewedAt: new Date() }, include });
    await audit(tx, { actor, action: "news-item.update", entityType: "NewsItem", entityId: id, before: auditShape(before), after: auditShape(updated) });
  });
  return getItem(id);
}

const auditShape = (r: Pick<NewsItem, "status" | "title" | "publicTitle" | "summary" | "category" | "stateId" | "isPinned" | "slug">) => ({
  status: r.status,
  title: r.title,
  publicTitle: r.publicTitle,
  summary: r.summary,
  category: r.category,
  stateId: r.stateId,
  isPinned: r.isPinned,
  slug: r.slug,
});

/** What each action may start from. Anything else is refused with a plain reason. */
const FROM: Record<"publish" | "reject" | "unpublish" | "restore", { from: NewsItemStatus[]; to: NewsItemStatus; why: string }> = {
  publish: { from: ["PENDING", "FILTERED", "BASELINE", "REJECTED", "UNPUBLISHED"], to: "PUBLISHED", why: "It is already published." },
  reject: { from: ["PENDING", "FILTERED", "BASELINE", "UNPUBLISHED"], to: "REJECTED", why: "A published notice must be unpublished before it can be rejected; a rejected one is already rejected." },
  unpublish: { from: ["PUBLISHED"], to: "UNPUBLISHED", why: "Only a published notice can be unpublished." },
  restore: { from: ["FILTERED", "BASELINE", "REJECTED", "UNPUBLISHED"], to: "PENDING", why: "Only a filtered, older, rejected or unpublished notice can be sent back to the review queue." },
};

function assertCan(action: keyof typeof FROM, status: NewsItemStatus) {
  if (!FROM[action].from.includes(status)) throw AppError.conflict(`This notice is ${status.toLowerCase()}. ${FROM[action].why}`);
}

/** The address part of a public notice: from its public title, made unique with -2, -3 ... Titles with no Latin letters fall back to `notice-<id start>`. */
async function uniqueSlug(title: string, id: string): Promise<string> {
  const base = slugifyShort(title, 80) || `notice-${id.slice(-8)}`;
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.newsItem.findFirst({ where: { slug: candidate, NOT: { id } }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${id.slice(-8)}`;
}

export async function publishItem(actor: AuditActor, id: string, input: ItemEdit) {
  const before = await loadItem(id);
  assertCan("publish", before.status);
  const errors: FieldError[] = [];
  await checkState(input.stateId, errors);
  const summary = input.summary !== undefined ? (optionalText(input.summary) ?? null) : before.summary;
  if (!summary) errors.push({ path: "summary", message: "Write a short summary in your own words before publishing." });
  if (errors.length) throw AppError.invalid("Please fix the highlighted fields.", errors);

  const publicTitle = input.publicTitle !== undefined ? (optionalText(input.publicTitle) ?? null) : before.publicTitle;
  const slug = before.slug ?? (await uniqueSlug(publicTitle ?? before.title, id));
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.newsItem.updateMany({
      where: { id, status: { in: FROM.publish.from } },
      data: { ...editData(input), slug, status: "PUBLISHED", reviewedById: actor.id, reviewedAt: now, publishedById: actor.id, publishedAt: before.publishedAt ?? now },
    });
    if (count === 0) throw AppError.conflict("Someone else just changed this notice. Reload it and try again.");
    const after = await tx.newsItem.findUniqueOrThrow({ where: { id } });
    await audit(tx, { actor, action: "news-item.publish", entityType: "NewsItem", entityId: id, before: auditShape(before), after: auditShape(after) });
  });
  return getItem(id);
}

async function decide(actor: AuditActor, id: string, action: "reject" | "unpublish" | "restore", note?: string | null) {
  const before = await loadItem(id);
  assertCan(action, before.status);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.newsItem.updateMany({
      where: { id, status: { in: FROM[action].from } },
      data: { status: FROM[action].to, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (count === 0) throw AppError.conflict("Someone else just changed this notice. Reload it and try again.");
    await audit(tx, { actor, action: `news-item.${action}`, entityType: "NewsItem", entityId: id, before: { status: before.status }, after: { status: FROM[action].to, ...(note ? { note } : {}) } });
  });
  return getItem(id);
}

export const rejectItem = (actor: AuditActor, id: string, note?: string | null) => decide(actor, id, "reject", note);
export const unpublishItem = (actor: AuditActor, id: string) => decide(actor, id, "unpublish");
export const restoreItem = (actor: AuditActor, id: string) => decide(actor, id, "restore");

/** Reject or restore many at once (clearing a page of obvious noise). Publishing is never bulk: every notice needs its own summary. */
export async function bulkDecide(actor: AuditActor, ids: string[], action: "reject" | "restore") {
  const unique = [...new Set(ids)];
  const rows = await prisma.newsItem.findMany({ where: { id: { in: unique } }, select: { id: true, status: true } });
  const byId = new Map(rows.map((r) => [r.id, r.status]));
  const skipped: Array<{ id: string; reason: string }> = [];
  const eligible: Array<{ id: string; status: NewsItemStatus }> = [];
  for (const id of unique) {
    const status = byId.get(id);
    if (!status) skipped.push({ id, reason: "Not found." });
    else if (!FROM[action].from.includes(status)) skipped.push({ id, reason: `It is ${status.toLowerCase()}. ${FROM[action].why}` });
    else eligible.push({ id, status });
  }
  if (eligible.length) {
    await prisma.$transaction(async (tx) => {
      await tx.newsItem.updateMany({ where: { id: { in: eligible.map((e) => e.id) }, status: { in: FROM[action].from } }, data: { status: FROM[action].to, reviewedById: actor.id, reviewedAt: new Date() } });
      for (const e of eligible) await audit(tx, { actor, action: `news-item.${action}`, entityType: "NewsItem", entityId: e.id, before: { status: e.status }, after: { status: FROM[action].to, bulk: true } });
    });
  }
  return { updated: eligible.length, skipped };
}

// ---- the public News page ------------------------------------------------------------------------------------

const publicWhere = (f: { state?: string; central?: boolean; category?: NewsCategory; q?: string }): Prisma.NewsItemWhereInput => {
  const q = f.q?.trim();
  return {
    status: "PUBLISHED",
    ...(f.state ? { state: { slug: f.state } } : {}),
    ...(f.central ? { stateId: null } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { publicTitle: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }] } : {}),
  };
};

const dateOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

type PublicRow = Prisma.NewsItemGetPayload<{ include: { source: { select: { name: true; siteUrl: true } }; state: { select: { slug: true; name: true } } } }>;
const publicInclude = { source: { select: { name: true, siteUrl: true } }, state: { select: { slug: true, name: true } } } as const;

const toPublic = (r: PublicRow) => ({
  slug: r.slug!,
  title: r.publicTitle ?? r.title,
  summary: r.summary ?? "",
  category: r.category,
  isPinned: r.isPinned,
  state: r.state,
  source: r.source,
  originalUrl: r.originalUrl,
  sourcePublishedOn: dateOnly(r.sourcePublishedAt),
  dateBasis: r.dateBasis,
  publishedAt: r.publishedAt!.toISOString(),
  checkedOn: dateOnly(r.reviewedAt ?? r.publishedAt),
});

export async function listPublicNews(f: { state?: string; central?: boolean; category?: NewsCategory; q?: string; page?: number; pageSize?: number }) {
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 20;
  const where = publicWhere(f);
  const [rows, total, states, categories] = await Promise.all([
    prisma.newsItem.findMany({ where, include: publicInclude, orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.newsItem.count({ where }),
    // The filter options: counted without the filter they offer, so choosing a state does not hide the other states.
    prisma.newsItem.groupBy({ by: ["stateId"], where: publicWhere({ category: f.category, q: f.q }), _count: { _all: true } }),
    prisma.newsItem.groupBy({ by: ["category"], where: publicWhere({ state: f.state, central: f.central, q: f.q }), _count: { _all: true } }),
  ]);
  const stateRows = await prisma.state.findMany({ where: { id: { in: states.map((s) => s.stateId).filter((x): x is string => !!x) } }, select: { id: true, slug: true, name: true } });
  const stateById = new Map(stateRows.map((s) => [s.id, s]));
  return {
    items: rows.map(toPublic),
    page,
    pageSize,
    total,
    facets: {
      states: states
        .filter((s) => s.stateId && stateById.has(s.stateId))
        .map((s) => ({ slug: stateById.get(s.stateId!)!.slug, name: stateById.get(s.stateId!)!.name, count: s._count._all }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      centralCount: states.find((s) => s.stateId === null)?._count._all ?? 0,
      categories: categories.map((c) => ({ category: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    },
  };
}

export async function getPublicNews(slug: string) {
  const row = await prisma.newsItem.findFirst({ where: { slug, status: "PUBLISHED" }, include: publicInclude });
  if (!row) throw AppError.notFound("We could not find that news item.");
  return toPublic(row);
}
