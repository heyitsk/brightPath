import { Prisma } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError, type FieldError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { slugifyShort } from "../../lib/slug";
import { assertNotEmpty, optionalText, parsePastDate, parseUrl, requiredText } from "../reference/reference.schemas";
import { checkReadiness, courseTotalInr, feeYearsRequired, lineTotalInr, lineTotalLocal, nmc2021Status, type FeeLineAmounts, type Missing, type ReadinessInput } from "./college-readiness";

// Admin operations on colleges (Phase 4b). Rules worth knowing:
//  - A new college is always a DRAFT. It goes live only through `markReady`, which refuses unless nothing is missing (D-087).
//  - A live (READY) college can still be edited, but never into an incomplete state: the edit is refused and rolled back.
//  - Slug and kind never change after creation (URLs and page layout depend on them).
//  - `totalCourseFeeInr` is recalculated inside the same transaction as every change that can affect it.

type Db = Prisma.TransactionClient | typeof prisma;
type Kind = "INDIA" | "ABROAD";

const refSelect = { id: true, slug: true, name: true } as const;
const stateSelect = { id: true, slug: true, name: true, code: true } as const;

const fullInclude = {
  country: { select: refSelect },
  state: { select: stateSelect },
  indiaProfile: true,
  abroadProfile: true,
  feeLines: { orderBy: { yearNumber: "asc" }, include: { source: { select: { id: true, title: true, url: true } } } },
  sourceLinks: { orderBy: { createdAt: "asc" }, include: { source: { select: { id: true, kind: true, title: true, url: true } } } },
  faqs: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
} satisfies Prisma.CollegeInclude;
type CollegeFull = Prisma.CollegeGetPayload<{ include: typeof fullInclude }>;

const listInclude = {
  country: { select: refSelect },
  state: { select: stateSelect },
  indiaProfile: true,
  abroadProfile: true,
  feeLines: { select: { yearNumber: true, tuition: true, hostel: true, other: true, currency: true, sourceId: true } },
  _count: { select: { sourceLinks: true } },
} satisfies Prisma.CollegeInclude;
type CollegeListRow = Prisma.CollegeGetPayload<{ include: typeof listInclude }>;

const num = (d: { toString(): string }) => Number(d.toString());
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function fail(fields: FieldError[]): never {
  throw AppError.invalid(fields.length === 1 ? "Please fix 1 thing below." : `Please fix ${fields.length} things below.`, fields);
}

// ---- exchange rates (read-only here; the Exchange rates page is step 4c) ----------------------

export async function loadRates(db: Db): Promise<Map<string, number>> {
  const rows = await db.fxRate.findMany();
  return new Map(rows.map((r) => [r.currency, num(r.rateToInr)]));
}

// ---- readiness ---------------------------------------------------------------------------------

type ReadinessSource = {
  kind: Kind;
  name: string;
  city: string;
  stateId: string | null;
  countryId: string | null;
  ownership: string | null;
  description: string | null;
  courseLengthMonths: number | null;
  indiaProfile: ReadinessInput["india"];
  abroadProfile: ReadinessInput["abroad"];
  feeLines: Array<{ yearNumber: number; tuition: { toString(): string }; currency: string; sourceId: string | null }>;
};

function readinessInput(c: ReadinessSource, sourceLinkCount: number, rates: Map<string, number>): ReadinessInput {
  return {
    kind: c.kind, name: c.name, city: c.city, stateId: c.stateId, countryId: c.countryId, ownership: c.ownership,
    description: c.description, courseLengthMonths: c.courseLengthMonths,
    india: c.indiaProfile, abroad: c.abroadProfile,
    fees: c.feeLines.map((f) => ({ yearNumber: f.yearNumber, tuition: num(f.tuition), currency: f.currency, hasSource: f.sourceId !== null })),
    sourceLinkCount,
    currenciesWithRate: new Set(rates.keys()),
  };
}

function readinessOf(c: CollegeFull | CollegeListRow, sourceLinkCount: number, rates: Map<string, number>) {
  const missing = checkReadiness(readinessInput(c, sourceLinkCount, rates));
  return { missing, feeYearsRequired: feeYearsRequired(c.courseLengthMonths), feeYearsFilled: c.feeLines.length };
}

// ---- DTOs --------------------------------------------------------------------------------------

function toSummaryDto(c: CollegeListRow, rates: Map<string, number>) {
  const r = readinessOf(c, c._count.sourceLinks, rates);
  return {
    id: c.id, slug: c.slug, kind: c.kind, name: c.name, city: c.city, status: c.status, ownership: c.ownership,
    country: c.country, state: c.state, courseLengthMonths: c.courseLengthMonths, totalCourseFeeInr: c.totalCourseFeeInr,
    readiness: { canMarkReady: r.missing.length === 0, missingCount: r.missing.length, feeYearsRequired: r.feeYearsRequired, feeYearsFilled: r.feeYearsFilled },
    readyAt: iso(c.readyAt), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}

function toFeeDto(f: CollegeFull["feeLines"][number], rates: Map<string, number>) {
  const a: FeeLineAmounts = { yearNumber: f.yearNumber, tuition: num(f.tuition), hostel: num(f.hostel), other: num(f.other), currency: f.currency };
  return {
    ...a, totalLocal: lineTotalLocal(a), rateToInr: f.currency === "INR" ? 1 : (rates.get(f.currency) ?? null), totalInr: lineTotalInr(a, rates),
    source: f.source, checkedAt: iso(f.checkedAt),
  };
}

function toDetailDto(c: CollegeFull, rates: Map<string, number>) {
  const r = readinessOf(c, c.sourceLinks.length, rates);
  const { collegeId: _i, ...i } = c.indiaProfile ?? { collegeId: "" };
  const { collegeId: _a, ...a } = c.abroadProfile ?? { collegeId: "" };
  return {
    id: c.id, slug: c.slug, kind: c.kind, name: c.name, shortName: c.shortName, city: c.city, status: c.status,
    country: c.country, state: c.state, ownership: c.ownership, establishedYear: c.establishedYear, courseLengthMonths: c.courseLengthMonths,
    description: c.description, heroImageUrl: c.heroImageUrl, websiteUrl: c.websiteUrl, internalNotes: c.internalNotes,
    locationBasis: c.locationBasis, importBatchId: c.importBatchId, totalCourseFeeInr: c.totalCourseFeeInr,
    totalFeeCalculatedAt: iso(c.totalFeeCalculatedAt), readyAt: iso(c.readyAt), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    india: c.indiaProfile ? { ...(i as Omit<NonNullable<CollegeFull["indiaProfile"]>, "collegeId">), nmcRecognitionCheckedAt: iso(c.indiaProfile.nmcRecognitionCheckedAt) } : null,
    abroad: c.abroadProfile
      ? {
          ...(a as Omit<NonNullable<CollegeFull["abroadProfile"]>, "collegeId">), wdomsCheckedAt: iso(c.abroadProfile.wdomsCheckedAt), nmcCheckedAt: iso(c.abroadProfile.nmcCheckedAt),
          meetsNmc2021: nmc2021Status(c.abroadProfile), eligibility: (c.abroadProfile.eligibility as Record<string, string> | null) ?? null,
        }
      : null,
    fees: c.feeLines.map((f) => toFeeDto(f, rates)),
    sources: c.sourceLinks.map((s) => ({ id: s.id, purpose: s.purpose, checkedAt: s.checkedAt.toISOString(), source: s.source })),
    faqs: c.faqs.map((f) => ({ question: f.question, answer: f.answer })),
    readiness: { canMarkReady: r.missing.length === 0, missing: r.missing, feeYearsRequired: r.feeYearsRequired, feeYearsFilled: r.feeYearsFilled },
  };
}

async function loadFull(db: Db, id: string): Promise<CollegeFull> {
  const c = await db.college.findUnique({ where: { id }, include: fullInclude });
  if (!c) throw AppError.notFound("College not found.");
  return c;
}

export async function getCollege(id: string) {
  return toDetailDto(await loadFull(prisma, id), await loadRates(prisma));
}

// ---- list --------------------------------------------------------------------------------------

export async function listColleges(q: { kind?: Kind; status?: "DRAFT" | "READY" | "ARCHIVED"; countryId?: string; stateId?: string; q?: string; limit?: number; cursor?: string }) {
  const limit = q.limit ?? 50;
  const search = q.q?.trim();
  const where: Prisma.CollegeWhereInput = {
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.countryId ? { countryId: q.countryId } : {}),
    ...(q.stateId ? { stateId: q.stateId } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { city: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, rates] = await Promise.all([
    prisma.college.findMany({
      where, include: listInclude, orderBy: [{ name: "asc" }, { id: "asc" }], take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
    prisma.college.count({ where }),
    loadRates(prisma),
  ]);
  const page = rows.slice(0, limit);
  return { items: page.map((c) => toSummaryDto(c, rates)), total, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

// ---- totals ------------------------------------------------------------------------------------

/** Recomputes `totalCourseFeeInr` for the given colleges (all colleges when `ids` is omitted). Call inside the same transaction as the change. */
export async function recalcCourseTotals(db: Db, ids?: string[]): Promise<number> {
  const rates = await loadRates(db);
  const rows = await db.college.findMany({
    where: ids ? { id: { in: ids } } : {},
    select: { id: true, courseLengthMonths: true, totalCourseFeeInr: true, feeLines: { select: { yearNumber: true, tuition: true, hostel: true, other: true, currency: true } } },
  });
  const now = new Date();
  let changed = 0;
  for (const c of rows) {
    const fees = c.feeLines.map((f) => ({ yearNumber: f.yearNumber, tuition: num(f.tuition), hostel: num(f.hostel), other: num(f.other), currency: f.currency }));
    const total = courseTotalInr(c.courseLengthMonths, fees, rates);
    if (total !== c.totalCourseFeeInr) {
      await db.college.update({ where: { id: c.id }, data: { totalCourseFeeInr: total, totalFeeCalculatedAt: now } });
      changed++;
    }
  }
  return changed;
}

/** For a live college: refuses (the caller's transaction then rolls back) if anything required is now missing. Returns the college as it now stands. */
export async function assertStillComplete(tx: Prisma.TransactionClient, id: string) {
  const c = await loadFull(tx, id);
  if (c.status === "READY") {
    const missing = readinessOf(c, c.sourceLinks.length, await loadRates(tx)).missing;
    if (missing.length) {
      throw AppError.invalid(
        `This college is live, so it cannot lose a required detail. Fill these in, or move the college back to draft first (${missing.length} missing).`,
        missing,
      );
    }
  }
  return c;
}

/** After any change: refresh the total and, for a live college, refuse (and roll back) a change that would leave something required missing. */
async function settle(tx: Prisma.TransactionClient, id: string) {
  await recalcCourseTotals(tx, [id]);
  return assertStillComplete(tx, id);
}

// ---- field helpers -----------------------------------------------------------------------------

const dateOrNull = (path: string, v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : parsePastDate(path, v));
const urlOrNull = (path: string, v: string | null | undefined) => (v === undefined ? undefined : v === null || v === "" ? null : parseUrl(path, v));

async function assertState(stateId: string) {
  if (!(await prisma.state.findUnique({ where: { id: stateId }, select: { id: true } }))) fail([{ path: "stateId", message: "There is no state with this id." }]);
}
async function assertCountry(countryId: string) {
  if (!(await prisma.country.findUnique({ where: { id: countryId }, select: { id: true } }))) fail([{ path: "countryId", message: "There is no country with this id." }]);
}

type IndiaInput = {
  nmcRecognised?: boolean | null; nmcRecognitionCheckedAt?: string | null; mbbsSeats?: number | null; hospitalName?: string | null; hospitalBeds?: number | null;
  dailyOutpatients?: number | null; serviceBondYears?: number | null; serviceBondPenaltyInr?: number | null; stipendInr?: number | null; domicileRule?: string | null;
};
type AbroadInput = {
  wdomsListed?: "LISTED" | "NOT_LISTED" | "UNKNOWN"; wdomsId?: string | null; wdomsUrl?: string | null; wdomsCheckedAt?: string | null; internshipMonths?: number | null;
  teachingLanguage?: string | null; languageNote?: string | null; intakeMonths?: number[]; seatsForIndians?: number | null; nmcLengthOk?: boolean | null;
  nmcEnglishOk?: boolean | null; nmcInternshipOk?: boolean | null; nmcCheckedAt?: string | null; eligibility?: Record<string, string> | null; documents?: string[];
};
type BaseInput = {
  shortName?: string | null; ownership?: "GOVERNMENT" | "PRIVATE" | "DEEMED" | "TRUST" | null; establishedYear?: number | null; courseLengthMonths?: number | null;
  description?: string | null; heroImageUrl?: string | null; websiteUrl?: string | null; internalNotes?: string | null;
};

function indiaData(i: IndiaInput): Prisma.CollegeIndiaProfileUncheckedUpdateInput {
  return {
    nmcRecognised: i.nmcRecognised,
    nmcRecognitionCheckedAt: dateOrNull("india.nmcRecognitionCheckedAt", i.nmcRecognitionCheckedAt),
    mbbsSeats: i.mbbsSeats, hospitalName: optionalText(i.hospitalName), hospitalBeds: i.hospitalBeds, dailyOutpatients: i.dailyOutpatients,
    serviceBondYears: i.serviceBondYears, serviceBondPenaltyInr: i.serviceBondPenaltyInr, stipendInr: i.stipendInr, domicileRule: optionalText(i.domicileRule),
  };
}

function abroadData(a: AbroadInput): Prisma.CollegeAbroadProfileUncheckedUpdateInput {
  return {
    wdomsListed: a.wdomsListed, wdomsId: optionalText(a.wdomsId), wdomsUrl: urlOrNull("abroad.wdomsUrl", a.wdomsUrl),
    wdomsCheckedAt: dateOrNull("abroad.wdomsCheckedAt", a.wdomsCheckedAt), internshipMonths: a.internshipMonths,
    teachingLanguage: optionalText(a.teachingLanguage), languageNote: optionalText(a.languageNote),
    intakeMonths: a.intakeMonths === undefined ? undefined : [...new Set(a.intakeMonths)].sort((x, y) => x - y),
    seatsForIndians: a.seatsForIndians, nmcLengthOk: a.nmcLengthOk, nmcEnglishOk: a.nmcEnglishOk, nmcInternshipOk: a.nmcInternshipOk,
    nmcCheckedAt: dateOrNull("abroad.nmcCheckedAt", a.nmcCheckedAt),
    eligibility: a.eligibility === undefined ? undefined : a.eligibility === null ? Prisma.DbNull : a.eligibility,
    documents: a.documents?.map((d) => d.trim()).filter(Boolean),
  };
}

/** Removes keys whose value is undefined, so Prisma leaves those columns alone. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function baseData(b: BaseInput) {
  return defined({
    shortName: optionalText(b.shortName), ownership: b.ownership, establishedYear: b.establishedYear, courseLengthMonths: b.courseLengthMonths,
    description: optionalText(b.description), heroImageUrl: urlOrNull("heroImageUrl", b.heroImageUrl), websiteUrl: urlOrNull("websiteUrl", b.websiteUrl),
    internalNotes: optionalText(b.internalNotes),
  });
}

function wrongKindFields(kind: Kind, body: { stateId?: string | null; countryId?: string | null; india?: object; abroad?: object }): FieldError[] {
  const out: FieldError[] = [];
  if (kind === "INDIA") {
    if (body.countryId) out.push({ path: "countryId", message: "An Indian college has a state, not a country." });
    if (body.abroad) out.push({ path: "abroad", message: "Foreign-college details cannot be set on an Indian college." });
  } else {
    if (body.stateId) out.push({ path: "stateId", message: "A foreign college has a country, not a state." });
    if (body.india) out.push({ path: "india", message: "Indian-college details cannot be set on a foreign college." });
  }
  return out;
}

// ---- slug ---------------------------------------------------------------------------------------

async function makeSlug(db: Db, name: string, place: string): Promise<string> {
  const root = slugifyShort(name);
  if (!root) fail([{ path: "name", message: "The name needs at least one letter or digit." }]);
  const taken = new Set((await db.college.findMany({ where: { slug: { startsWith: root } }, select: { slug: true } })).map((c) => c.slug));
  const placeSlug = slugifyShort(place, 30);
  const candidates = [root, ...(placeSlug ? [`${root}-${placeSlug}`] : []), ...Array.from({ length: 20 }, (_, i) => `${root}-${placeSlug || "college"}-${i + 2}`)];
  const slug = candidates.find((c) => !taken.has(c));
  if (!slug) throw AppError.conflict("Could not build a unique web address for this college. Change the name slightly.");
  return slug;
}

// ---- create / update / delete -------------------------------------------------------------------

export async function createCollege(
  actor: AuditActor,
  body: BaseInput & { kind: Kind; name: string; city: string; stateId?: string | null; countryId?: string | null; india?: IndiaInput; abroad?: AbroadInput },
) {
  const fields = wrongKindFields(body.kind, body);
  if (fields.length) fail(fields);
  const name = requiredText("name", body.name);
  const city = requiredText("city", body.city);
  if (body.stateId) await assertState(body.stateId);
  if (body.countryId) await assertCountry(body.countryId);
  const base = baseData(body);

  const id = await prisma.$transaction(async (tx) => {
    const place = body.kind === "INDIA"
      ? (body.stateId ? (await tx.state.findUniqueOrThrow({ where: { id: body.stateId } })).slug : city)
      : (body.countryId ? (await tx.country.findUniqueOrThrow({ where: { id: body.countryId } })).slug : city);
    const slug = await makeSlug(tx, name, place);
    const c = await tx.college.create({
      data: {
        ...base, slug, kind: body.kind, name, city, status: "DRAFT",
        stateId: body.kind === "INDIA" ? (body.stateId ?? null) : null,
        countryId: body.kind === "ABROAD" ? (body.countryId ?? null) : null,
        ...(body.kind === "INDIA"
          ? { indiaProfile: { create: defined(indiaData(body.india ?? {})) as never } }
          : { abroadProfile: { create: defined(abroadData(body.abroad ?? {})) as never } }),
      },
    });
    await recalcCourseTotals(tx, [c.id]);
    await audit(tx, { actor, action: "college.create", entityType: "College", entityId: c.id, after: toDetailDto(await loadFull(tx, c.id), new Map()) });
    return c.id;
  });
  return getCollege(id);
}

export async function updateCollege(
  actor: AuditActor,
  id: string,
  body: BaseInput & { name?: string; city?: string; stateId?: string | null; countryId?: string | null; india?: IndiaInput; abroad?: AbroadInput },
) {
  assertNotEmpty(body);
  const rates = await loadRates(prisma);
  const before = await loadFull(prisma, id);
  const fields = wrongKindFields(before.kind, body);
  if (fields.length) fail(fields);
  if (body.stateId) await assertState(body.stateId);
  if (body.countryId) await assertCountry(body.countryId);
  const beforeDto = toDetailDto(before, rates);

  await prisma.$transaction(async (tx) => {
    await tx.college.update({
      where: { id },
      data: {
        ...baseData(body),
        ...(body.name !== undefined ? { name: requiredText("name", body.name) } : {}),
        ...(body.city !== undefined ? { city: requiredText("city", body.city) } : {}),
        ...(body.stateId !== undefined ? { stateId: body.stateId } : {}),
        ...(body.countryId !== undefined ? { countryId: body.countryId } : {}),
      },
    });
    if (body.india) await tx.collegeIndiaProfile.upsert({ where: { collegeId: id }, update: defined(indiaData(body.india)), create: { collegeId: id, ...(defined(indiaData(body.india)) as object) } });
    if (body.abroad) await tx.collegeAbroadProfile.upsert({ where: { collegeId: id }, update: defined(abroadData(body.abroad)), create: { collegeId: id, ...(defined(abroadData(body.abroad)) as object) } });
    const after = await settle(tx, id);
    await audit(tx, { actor, action: "college.update", entityType: "College", entityId: id, before: beforeDto, after: toDetailDto(after, await loadRates(tx)) });
  });
  return getCollege(id);
}

/** Only drafts can be deleted. Anything that has been live is archived instead, so its history and links survive. */
export async function deleteCollege(actor: AuditActor, id: string) {
  const before = await loadFull(prisma, id);
  if (before.status !== "DRAFT") throw AppError.conflict("Only a draft can be deleted. Archive a college that has been live.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.college.delete({ where: { id } });
      await audit(tx, { actor, action: "college.delete", entityType: "College", entityId: id, before: toDetailDto(before, new Map()) });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2003") throw AppError.conflict("NMC notices still refer to this college, so it cannot be deleted. Archive it instead.");
    throw err;
  }
}

// ---- status transitions -------------------------------------------------------------------------

/** Draft -> live. Refused with the full list of missing details unless the gate passes (D-087). */
export async function markReady(actor: AuditActor, id: string) {
  const before = await loadFull(prisma, id);
  if (before.status === "READY") return getCollege(id);
  if (before.status === "ARCHIVED") throw AppError.conflict("This college is archived. Move it back to draft first, then mark it ready.");
  await prisma.$transaction(async (tx) => {
    await recalcCourseTotals(tx, [id]);
    const c = await loadFull(tx, id);
    const missing = readinessOf(c, c.sourceLinks.length, await loadRates(tx)).missing;
    if (missing.length) {
      failNotReady(missing);
    }
    await tx.college.update({ where: { id }, data: { status: "READY", readyAt: new Date() } });
    await audit(tx, { actor, action: "college.ready", entityType: "College", entityId: id, before: { status: before.status }, after: { status: "READY", totalCourseFeeInr: c.totalCourseFeeInr } });
  });
  return getCollege(id);
}

function failNotReady(missing: Missing[]): never {
  throw AppError.invalid(
    missing.length === 1 ? "This college cannot go live yet: 1 required detail is missing." : `This college cannot go live yet: ${missing.length} required details are missing.`,
    missing,
  );
}

/** Takes a live or archived college back to draft (no longer public). */
export async function moveToDraft(actor: AuditActor, id: string) {
  const before = await loadFull(prisma, id);
  if (before.status === "DRAFT") return getCollege(id);
  await prisma.$transaction(async (tx) => {
    await tx.college.update({ where: { id }, data: { status: "DRAFT", readyAt: null } });
    await audit(tx, { actor, action: "college.draft", entityType: "College", entityId: id, before: { status: before.status }, after: { status: "DRAFT" } });
  });
  return getCollege(id);
}

export async function archiveCollege(actor: AuditActor, id: string) {
  const before = await loadFull(prisma, id);
  if (before.status === "ARCHIVED") return getCollege(id);
  await prisma.$transaction(async (tx) => {
    await tx.college.update({ where: { id }, data: { status: "ARCHIVED", readyAt: null } });
    await audit(tx, { actor, action: "college.archive", entityType: "College", entityId: id, before: { status: before.status }, after: { status: "ARCHIVED" } });
  });
  return getCollege(id);
}

// ---- fees ---------------------------------------------------------------------------------------

type FeeInput = { tuition: number; hostel?: number; other?: number; currency: string; sourceId: string | null; checkedAt?: string | null };

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) / 100 - v) < 1e-9;

export async function setFee(actor: AuditActor, collegeId: string, yearNumber: number, input: FeeInput) {
  const college = await prisma.college.findUnique({ where: { id: collegeId }, select: { courseLengthMonths: true } });
  if (!college) throw AppError.notFound("College not found.");
  const errors: FieldError[] = [];
  const required = feeYearsRequired(college.courseLengthMonths);
  if (yearNumber < 1 || yearNumber > 12) errors.push({ path: "year", message: "The year must be between 1 and 12." });
  else if (required && yearNumber > required) errors.push({ path: "year", message: `This course has only ${required} years, so there is no year ${yearNumber}. Change the course length first if that is wrong.` });
  for (const k of ["tuition", "hostel", "other"] as const) {
    const v = input[k];
    if (v !== undefined && !twoDecimals(v)) errors.push({ path: k, message: "Use at most 2 decimal places." });
  }
  if (input.sourceId && !(await prisma.source.findUnique({ where: { id: input.sourceId }, select: { id: true } }))) errors.push({ path: "sourceId", message: "There is no source with this id." });
  let checkedAt = new Date();
  if (input.checkedAt) {
    try { checkedAt = parsePastDate("checkedAt", input.checkedAt); } catch (e) { errors.push(...((e as AppError).fields ?? [])); }
  }
  if (errors.length) fail(errors);

  const data = {
    tuition: input.tuition, hostel: input.hostel ?? 0, other: input.other ?? 0, currency: input.currency.toUpperCase(),
    sourceId: input.sourceId, checkedAt,
  };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.collegeFeeLine.findUnique({ where: { collegeId_yearNumber: { collegeId, yearNumber } } });
    await tx.collegeFeeLine.upsert({ where: { collegeId_yearNumber: { collegeId, yearNumber } }, update: data, create: { collegeId, yearNumber, ...data } });
    await settle(tx, collegeId);
    await audit(tx, {
      actor, action: existing ? "college.fee_update" : "college.fee_create", entityType: "College", entityId: collegeId,
      before: existing ? { yearNumber, tuition: num(existing.tuition), hostel: num(existing.hostel), other: num(existing.other), currency: existing.currency, sourceId: existing.sourceId } : undefined,
      after: { yearNumber, ...data },
    });
  });
  return getCollege(collegeId);
}

export async function deleteFee(actor: AuditActor, collegeId: string, yearNumber: number) {
  const existing = await prisma.collegeFeeLine.findUnique({ where: { collegeId_yearNumber: { collegeId, yearNumber } } });
  if (!existing) {
    if (!(await prisma.college.findUnique({ where: { id: collegeId }, select: { id: true } }))) throw AppError.notFound("College not found.");
    throw AppError.notFound(`There is no fee row for year ${yearNumber}.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.collegeFeeLine.delete({ where: { id: existing.id } });
    await settle(tx, collegeId);
    await audit(tx, {
      actor, action: "college.fee_delete", entityType: "College", entityId: collegeId,
      before: { yearNumber, tuition: num(existing.tuition), hostel: num(existing.hostel), other: num(existing.other), currency: existing.currency, sourceId: existing.sourceId },
    });
  });
  return getCollege(collegeId);
}

// ---- source links -------------------------------------------------------------------------------

export async function addSourceLink(actor: AuditActor, collegeId: string, input: { sourceId: string; purpose: Prisma.CollegeSourceLinkUncheckedCreateInput["purpose"]; checkedAt: string }) {
  if (!(await prisma.college.findUnique({ where: { id: collegeId }, select: { id: true } }))) throw AppError.notFound("College not found.");
  if (!(await prisma.source.findUnique({ where: { id: input.sourceId }, select: { id: true } }))) fail([{ path: "sourceId", message: "There is no source with this id." }]);
  const checkedAt = parsePastDate("checkedAt", input.checkedAt);
  if (await prisma.collegeSourceLink.findUnique({ where: { collegeId_sourceId_purpose: { collegeId, sourceId: input.sourceId, purpose: input.purpose } } })) {
    throw AppError.conflict("This source is already linked for that purpose. Update its checked date instead.");
  }
  await prisma.$transaction(async (tx) => {
    const link = await tx.collegeSourceLink.create({ data: { collegeId, sourceId: input.sourceId, purpose: input.purpose, checkedAt, checkedById: actor.id } });
    await audit(tx, { actor, action: "college.source_add", entityType: "College", entityId: collegeId, after: { linkId: link.id, sourceId: input.sourceId, purpose: input.purpose, checkedAt } });
  });
  return getCollege(collegeId);
}

export async function updateSourceLink(actor: AuditActor, collegeId: string, linkId: string, input: { purpose?: Prisma.CollegeSourceLinkUncheckedCreateInput["purpose"]; checkedAt?: string }) {
  assertNotEmpty(input);
  const link = await prisma.collegeSourceLink.findFirst({ where: { id: linkId, collegeId } });
  if (!link) throw AppError.notFound("That source link was not found on this college.");
  const checkedAt = input.checkedAt ? parsePastDate("checkedAt", input.checkedAt) : undefined;
  if (input.purpose && input.purpose !== link.purpose) {
    if (await prisma.collegeSourceLink.findUnique({ where: { collegeId_sourceId_purpose: { collegeId, sourceId: link.sourceId, purpose: input.purpose } } })) {
      throw AppError.conflict("This source is already linked for that purpose.");
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.collegeSourceLink.update({ where: { id: linkId }, data: { ...(input.purpose ? { purpose: input.purpose } : {}), ...(checkedAt ? { checkedAt, checkedById: actor.id } : {}) } });
    await audit(tx, { actor, action: "college.source_update", entityType: "College", entityId: collegeId, before: { purpose: link.purpose, checkedAt: link.checkedAt }, after: { purpose: input.purpose ?? link.purpose, checkedAt: checkedAt ?? link.checkedAt } });
  });
  return getCollege(collegeId);
}

export async function removeSourceLink(actor: AuditActor, collegeId: string, linkId: string) {
  const link = await prisma.collegeSourceLink.findFirst({ where: { id: linkId, collegeId } });
  if (!link) throw AppError.notFound("That source link was not found on this college.");
  await prisma.$transaction(async (tx) => {
    await tx.collegeSourceLink.delete({ where: { id: linkId } });
    await settle(tx, collegeId);
    await audit(tx, { actor, action: "college.source_remove", entityType: "College", entityId: collegeId, before: { sourceId: link.sourceId, purpose: link.purpose } });
  });
  return getCollege(collegeId);
}

// ---- FAQs ---------------------------------------------------------------------------------------

export async function replaceFaqs(actor: AuditActor, collegeId: string, items: Array<{ question: string; answer: string }>) {
  const college = await prisma.college.findUnique({ where: { id: collegeId }, include: { faqs: true } });
  if (!college) throw AppError.notFound("College not found.");
  const clean = items.map((f, i) => ({ question: requiredText(`items.${i}.question`, f.question), answer: requiredText(`items.${i}.answer`, f.answer) }));
  await prisma.$transaction(async (tx) => {
    await tx.collegeFaq.deleteMany({ where: { collegeId } });
    await tx.collegeFaq.createMany({ data: clean.map((f, i) => ({ collegeId, ...f, sort: i })) });
    await audit(tx, { actor, action: "college.faqs_replace", entityType: "College", entityId: collegeId, before: { count: college.faqs.length }, after: { count: clean.length } });
  });
  return getCollege(collegeId);
}
