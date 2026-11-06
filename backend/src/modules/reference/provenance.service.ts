import type { NmcNotice, Prisma, Source } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { optionalText, parsePastDate, parseUrl, requiredText } from "./reference.schemas";

// Sources and NMC notices: the "where did this fact come from" records (plan §3.3 rule 3).

type SourceKind = Source["kind"];

// ---- sources ---------------------------------------------------------------------------

export const toSourceDto = (s: Source) => ({
  id: s.id,
  kind: s.kind,
  title: s.title,
  publisher: s.publisher,
  url: s.url,
  notes: s.notes,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export async function listSources(q: { kind?: SourceKind; q?: string; limit?: number; cursor?: string }) {
  const limit = q.limit ?? 50;
  const search = q.q?.trim();
  const rows = await prisma.source.findMany({
    where: {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { publisher: { contains: search, mode: "insensitive" } }] } : {}),
      ...(q.cursor ? { id: { lt: q.cursor } } : {}),
    },
    orderBy: { id: "desc" }, // UUIDv7: id order is creation order
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return { items: page.map(toSourceDto), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

export async function getSource(id: string) {
  const s = await prisma.source.findUnique({ where: { id } });
  if (!s) throw AppError.notFound("Source not found.");
  return toSourceDto(s);
}

export async function createSource(actor: AuditActor, input: { kind: SourceKind; title: string; publisher?: string | null; url?: string | null; notes?: string | null }) {
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.source.create({
      data: {
        kind: input.kind,
        title: requiredText("title", input.title),
        publisher: optionalText(input.publisher) ?? null,
        url: input.url ? parseUrl("url", input.url) : null,
        notes: optionalText(input.notes) ?? null,
        createdById: actor.id,
      },
    });
    await audit(tx, { actor, action: "source.create", entityType: "Source", entityId: s.id, after: toSourceDto(s) });
    return s;
  });
  return toSourceDto(created);
}

export async function updateSource(
  actor: AuditActor,
  id: string,
  input: { kind?: SourceKind; title?: string; publisher?: string | null; url?: string | null; notes?: string | null },
) {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Source not found.");
  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.source.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: requiredText("title", input.title) } : {}),
        ...(input.publisher !== undefined ? { publisher: optionalText(input.publisher) } : {}),
        ...(input.url !== undefined ? { url: input.url ? parseUrl("url", input.url) : null } : {}),
        ...(input.notes !== undefined ? { notes: optionalText(input.notes) } : {}),
      },
    });
    await audit(tx, { actor, action: "source.update", entityType: "Source", entityId: id, before: toSourceDto(before), after: toSourceDto(s) });
    return s;
  });
  return toSourceDto(updated);
}

/** Blocked while anything cites the source (foreign keys added in later phases surface here as P2003). */
export async function deleteSource(actor: AuditActor, id: string) {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Source not found.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.source.delete({ where: { id } });
      await audit(tx, { actor, action: "source.delete", entityType: "Source", entityId: id, before: toSourceDto(before) });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2003") throw AppError.conflict("This source is cited by other records, so it cannot be deleted.");
    throw err;
  }
}

// ---- NMC notices -----------------------------------------------------------------------

type NoticeWithCountry = NmcNotice & { country: { id: string; slug: string; name: string } | null };

const withCountry = { country: { select: { id: true, slug: true, name: true } } } as const;

export const toNoticeDto = (n: NoticeWithCountry) => ({
  id: n.id,
  title: n.title,
  url: n.url,
  publishedAt: n.publishedAt.toISOString(),
  severity: n.severity,
  scope: n.scope,
  country: n.country,
  collegeId: n.collegeId,
  isActive: n.isActive,
  checkedAt: n.checkedAt.toISOString(),
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
});

async function assertCountryExists(countryId: string) {
  if (!(await prisma.country.findUnique({ where: { id: countryId }, select: { id: true } }))) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "countryId", message: "There is no country with this id." }]);
  }
}

export async function listNotices(q: { scope?: NmcNotice["scope"]; countryId?: string; isActive?: boolean; limit?: number; cursor?: string }) {
  const limit = q.limit ?? 50;
  const where: Prisma.NmcNoticeWhereInput = {
    ...(q.scope ? { scope: q.scope } : {}),
    ...(q.countryId ? { countryId: q.countryId } : {}),
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
    ...(q.cursor ? { id: { lt: q.cursor } } : {}),
  };
  const rows = await prisma.nmcNotice.findMany({ where, orderBy: { id: "desc" }, take: limit + 1, include: withCountry });
  const page = rows.slice(0, limit);
  return { items: page.map(toNoticeDto), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

export async function getNotice(id: string) {
  const n = await prisma.nmcNotice.findUnique({ where: { id }, include: withCountry });
  if (!n) throw AppError.notFound("NMC notice not found.");
  return toNoticeDto(n);
}

export async function createNotice(
  actor: AuditActor,
  input: {
    title: string;
    url: string;
    publishedAt: string;
    severity: NmcNotice["severity"];
    scope: NmcNotice["scope"];
    countryId?: string;
    isActive?: boolean;
    checkedAt: string;
  },
) {
  if (input.scope === "COLLEGE") {
    // College-level notices need the college table (Phase 4); refusing now avoids dangling ids.
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "scope", message: "College-level notices can be added once the college catalogue exists. Use COUNTRY for now." }]);
  }
  if (!input.countryId) throw AppError.invalid("Please fix 1 thing below.", [{ path: "countryId", message: "Choose the country this notice is about." }]);
  await assertCountryExists(input.countryId);
  const data = {
    title: requiredText("title", input.title),
    url: parseUrl("url", input.url),
    publishedAt: parsePastDate("publishedAt", input.publishedAt),
    checkedAt: parsePastDate("checkedAt", input.checkedAt),
    severity: input.severity,
    scope: input.scope,
    countryId: input.countryId,
    isActive: input.isActive ?? true,
    createdById: actor.id,
  };
  const created = await prisma.$transaction(async (tx) => {
    const n = await tx.nmcNotice.create({ data, include: withCountry });
    await audit(tx, { actor, action: "nmc_notice.create", entityType: "NmcNotice", entityId: n.id, after: toNoticeDto(n) });
    return n;
  });
  return toNoticeDto(created);
}

export async function updateNotice(
  actor: AuditActor,
  id: string,
  input: { title?: string; url?: string; publishedAt?: string; severity?: NmcNotice["severity"]; countryId?: string; isActive?: boolean; checkedAt?: string },
) {
  const before = await prisma.nmcNotice.findUnique({ where: { id }, include: withCountry });
  if (!before) throw AppError.notFound("NMC notice not found.");
  if (input.countryId !== undefined) {
    if (before.scope !== "COUNTRY") throw AppError.invalid("Please fix 1 thing below.", [{ path: "countryId", message: "Only country-level notices have a country." }]);
    await assertCountryExists(input.countryId);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const n = await tx.nmcNotice.update({
      where: { id },
      include: withCountry,
      data: {
        ...(input.title !== undefined ? { title: requiredText("title", input.title) } : {}),
        ...(input.url !== undefined ? { url: parseUrl("url", input.url) } : {}),
        ...(input.publishedAt !== undefined ? { publishedAt: parsePastDate("publishedAt", input.publishedAt) } : {}),
        ...(input.checkedAt !== undefined ? { checkedAt: parsePastDate("checkedAt", input.checkedAt) } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await audit(tx, { actor, action: "nmc_notice.update", entityType: "NmcNotice", entityId: id, before: toNoticeDto(before), after: toNoticeDto(n) });
    return n;
  });
  return toNoticeDto(updated);
}

export async function deleteNotice(actor: AuditActor, id: string) {
  const before = await prisma.nmcNotice.findUnique({ where: { id }, include: withCountry });
  if (!before) throw AppError.notFound("NMC notice not found.");
  await prisma.$transaction(async (tx) => {
    await tx.nmcNotice.delete({ where: { id } });
    await audit(tx, { actor, action: "nmc_notice.delete", entityType: "NmcNotice", entityId: id, before: toNoticeDto(before) });
  });
}
