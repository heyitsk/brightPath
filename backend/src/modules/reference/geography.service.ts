import type { Country, State } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { normalizeAliases, optionalText, requiredText } from "./reference.schemas";

// States and countries: created by staff (or the seed), edited, never deleted.

const dup = (path: string, message: string) => AppError.invalid("Please fix 1 thing below.", [{ path, message }]);

// ---- states ----------------------------------------------------------------------------

export const toStateDto = (s: State) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  code: s.code,
  isLive: s.isLive,
  sortOrder: s.sortOrder,
  aliases: s.aliases,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export async function listStates(filter: { isLive?: boolean }) {
  const rows = await prisma.state.findMany({
    where: filter.isLive === undefined ? {} : { isLive: filter.isLive },
    orderBy: [{ isLive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toStateDto);
}

async function assertStateFree(input: { slug?: string; code?: string }, exceptId?: string) {
  const clash = await prisma.state.findFirst({
    where: { id: exceptId ? { not: exceptId } : undefined, OR: [...(input.slug ? [{ slug: input.slug }] : []), ...(input.code ? [{ code: input.code }] : [])] },
  });
  if (!clash) return;
  if (input.slug && clash.slug === input.slug) throw dup("slug", "Another state already uses this slug.");
  throw dup("code", "Another state already uses this code.");
}

export async function createState(actor: AuditActor, input: { slug: string; name: string; code: string; isLive?: boolean; sortOrder?: number; aliases?: string[] }) {
  const data = {
    slug: input.slug,
    name: requiredText("name", input.name),
    code: input.code,
    isLive: input.isLive ?? false,
    sortOrder: input.sortOrder ?? 1000,
    aliases: normalizeAliases(input.aliases ?? []),
  };
  await assertStateFree(data);
  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.state.create({ data });
    await audit(tx, { actor, action: "state.create", entityType: "State", entityId: s.id, after: toStateDto(s) });
    return s;
  });
  return toStateDto(created);
}

export async function updateState(
  actor: AuditActor,
  id: string,
  input: { name?: string; code?: string; isLive?: boolean; sortOrder?: number; aliases?: string[] },
) {
  const before = await prisma.state.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("State not found.");
  if (input.code !== undefined) await assertStateFree({ code: input.code }, id);
  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.state.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: requiredText("name", input.name) } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.isLive !== undefined ? { isLive: input.isLive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.aliases !== undefined ? { aliases: normalizeAliases(input.aliases) } : {}),
      },
    });
    await audit(tx, { actor, action: "state.update", entityType: "State", entityId: id, before: toStateDto(before), after: toStateDto(s) });
    return s;
  });
  return toStateDto(updated);
}

// ---- countries -------------------------------------------------------------------------

type CountryWithCount = Country & { _count: { nmcNotices: number } };

export const toCountryDto = (c: CountryWithCount) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  isoCode: c.isoCode,
  status: c.status,
  nearIndia: c.nearIndia,
  typicalFlightFromDelhi: c.typicalFlightFromDelhi,
  sortOrder: c.sortOrder,
  aliases: c.aliases,
  activeNmcNoticeCount: c._count.nmcNotices,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const withCount = { _count: { select: { nmcNotices: { where: { isActive: true } } } } } as const;

export async function listCountries(filter: { status?: "LIVE" | "COMING_SOON" }) {
  const rows = await prisma.country.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { name: "asc" }], // enum order: LIVE before COMING_SOON
    include: withCount,
  });
  return rows.map(toCountryDto);
}

async function assertCountryFree(input: { slug?: string; isoCode?: string }, exceptId?: string) {
  const clash = await prisma.country.findFirst({
    where: { id: exceptId ? { not: exceptId } : undefined, OR: [...(input.slug ? [{ slug: input.slug }] : []), ...(input.isoCode ? [{ isoCode: input.isoCode }] : [])] },
  });
  if (!clash) return;
  if (input.slug && clash.slug === input.slug) throw dup("slug", "Another country already uses this slug.");
  throw dup("isoCode", "Another country already uses this ISO code.");
}

export async function createCountry(
  actor: AuditActor,
  input: {
    slug: string;
    name: string;
    isoCode: string;
    status?: "LIVE" | "COMING_SOON";
    nearIndia?: boolean;
    typicalFlightFromDelhi?: string | null;
    sortOrder?: number;
    aliases?: string[];
  },
) {
  const data = {
    slug: input.slug,
    name: requiredText("name", input.name),
    isoCode: input.isoCode,
    status: input.status ?? "COMING_SOON",
    nearIndia: input.nearIndia ?? false,
    typicalFlightFromDelhi: optionalText(input.typicalFlightFromDelhi) ?? null,
    sortOrder: input.sortOrder ?? 1000,
    aliases: normalizeAliases(input.aliases ?? []),
  };
  await assertCountryFree(data);
  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.country.create({ data, include: withCount });
    await audit(tx, { actor, action: "country.create", entityType: "Country", entityId: c.id, after: toCountryDto(c) });
    return c;
  });
  return toCountryDto(created);
}

export async function updateCountry(
  actor: AuditActor,
  id: string,
  input: {
    name?: string;
    isoCode?: string;
    status?: "LIVE" | "COMING_SOON";
    nearIndia?: boolean;
    typicalFlightFromDelhi?: string | null;
    sortOrder?: number;
    aliases?: string[];
  },
) {
  const before = await prisma.country.findUnique({ where: { id }, include: withCount });
  if (!before) throw AppError.notFound("Country not found.");
  if (input.isoCode !== undefined) await assertCountryFree({ isoCode: input.isoCode }, id);
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.country.update({
      where: { id },
      include: withCount,
      data: {
        ...(input.name !== undefined ? { name: requiredText("name", input.name) } : {}),
        ...(input.isoCode !== undefined ? { isoCode: input.isoCode } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.nearIndia !== undefined ? { nearIndia: input.nearIndia } : {}),
        ...(input.typicalFlightFromDelhi !== undefined ? { typicalFlightFromDelhi: optionalText(input.typicalFlightFromDelhi) } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.aliases !== undefined ? { aliases: normalizeAliases(input.aliases) } : {}),
      },
    });
    await audit(tx, { actor, action: "country.update", entityType: "Country", entityId: id, before: toCountryDto(before), after: toCountryDto(c) });
    return c;
  });
  return toCountryDto(updated);
}
