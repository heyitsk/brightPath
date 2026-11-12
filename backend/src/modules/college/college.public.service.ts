import type { Prisma } from "../../generated/prisma/client";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { lineTotalInr, lineTotalLocal, nmc2021Status } from "./college-readiness";

// Public read side of the college catalogue (Phase 4e). Read-only, no staff data.
//
// WHO IS VISIBLE (history.md D-115): a college is public only when it is READY and, for a foreign college, its country is LIVE.
// An Indian college needs only READY. Anything else answers exactly like a college that does not exist (404), so a draft's
// web address cannot even be confirmed to exist.

export const publicWhere: Prisma.CollegeWhereInput = {
  status: "READY",
  OR: [{ kind: "INDIA" }, { kind: "ABROAD", country: { is: { status: "LIVE" } } }],
};

const num = (d: { toString(): string }) => Number(d.toString());
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

type Severity = "NONE" | "ADVISORY" | "WARNING";
const SEVERITY_RANK: Record<Severity, number> = { NONE: 0, ADVISORY: 1, WARNING: 2 };

const cardInclude = {
  country: { select: { slug: true, name: true } },
  state: { select: { slug: true, name: true, code: true } },
  indiaProfile: true,
  abroadProfile: true,
  sourceLinks: { select: { checkedAt: true } },
  feeLines: { select: { checkedAt: true } },
} satisfies Prisma.CollegeInclude;
type CardRow = Prisma.CollegeGetPayload<{ include: typeof cardInclude }>;

/** The OLDEST check date among everything the page shows, so "checked on" never claims more than is true. */
function oldestCheck(c: CardRow): Date | null {
  const dates: Date[] = [
    ...c.sourceLinks.map((s) => s.checkedAt),
    ...c.feeLines.map((f) => f.checkedAt).filter((d): d is Date => d !== null),
    ...(c.indiaProfile?.nmcRecognitionCheckedAt ? [c.indiaProfile.nmcRecognitionCheckedAt] : []),
    ...(c.abroadProfile?.wdomsCheckedAt ? [c.abroadProfile.wdomsCheckedAt] : []),
    ...(c.abroadProfile?.nmcCheckedAt ? [c.abroadProfile.nmcCheckedAt] : []),
  ];
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
}

interface Notice {
  title: string;
  url: string;
  publishedAt: Date;
  severity: "ADVISORY" | "WARNING";
  scope: "COLLEGE" | "COUNTRY";
  checkedAt: Date;
  collegeId: string | null;
  countryId: string | null;
}

/** Active NMC notices for these colleges (their own, plus their country's), keyed by college id. */
async function noticesFor(colleges: Array<{ id: string; countryId: string | null }>): Promise<Map<string, Notice[]>> {
  const out = new Map<string, Notice[]>(colleges.map((c) => [c.id, []]));
  if (!colleges.length) return out;
  const countryIds = [...new Set(colleges.map((c) => c.countryId).filter((x): x is string => x !== null))];
  const rows = await prisma.nmcNotice.findMany({
    where: { isActive: true, OR: [{ collegeId: { in: colleges.map((c) => c.id) } }, ...(countryIds.length ? [{ countryId: { in: countryIds } }] : [])] },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
  for (const c of colleges) {
    out.set(c.id, rows.filter((n) => n.collegeId === c.id || (n.scope === "COUNTRY" && n.countryId !== null && n.countryId === c.countryId)));
  }
  return out;
}

const alertOf = (notices: Notice[]): Severity => notices.reduce<Severity>((hi, n) => (SEVERITY_RANK[n.severity] > SEVERITY_RANK[hi] ? n.severity : hi), "NONE");

function toCard(c: CardRow, notices: Notice[]) {
  return {
    slug: c.slug, kind: c.kind, name: c.name, shortName: c.shortName, city: c.city, country: c.country, state: c.state, ownership: c.ownership,
    establishedYear: c.establishedYear, heroImageUrl: c.heroImageUrl, courseLengthMonths: c.courseLengthMonths, totalCourseFeeInr: c.totalCourseFeeInr,
    badges: {
      nmcAlert: alertOf(notices),
      nmcRecognised: c.kind === "INDIA" ? (c.indiaProfile?.nmcRecognised ?? null) : null,
      wdomsListed: c.kind === "ABROAD" ? (c.abroadProfile?.wdomsListed ?? "UNKNOWN") : null,
      meetsNmc2021: c.kind === "ABROAD" ? (c.abroadProfile ? nmc2021Status(c.abroadProfile) : "UNKNOWN") : null,
    },
    dataCheckedAt: iso(oldestCheck(c)),
  };
}

async function cards(rows: CardRow[]) {
  const notices = await noticesFor(rows.map((r) => ({ id: r.id, countryId: r.countryId })));
  return rows.map((r) => toCard(r, notices.get(r.id) ?? []));
}

// ---- list --------------------------------------------------------------------------------------

export interface ListQuery {
  kind?: "INDIA" | "ABROAD";
  country?: string;
  state?: string;
  ownership?: "GOVERNMENT" | "PRIVATE" | "DEEMED" | "TRUST";
  q?: string;
  minFeeInr?: number;
  maxFeeInr?: number;
  sort?: "name" | "fee_asc" | "fee_desc";
  page?: number;
  pageSize?: number;
}

export async function listPublicColleges(q: ListQuery) {
  const pageSize = q.pageSize ?? 24;
  const page = q.page ?? 1;
  const search = q.q?.trim();
  const filters: Prisma.CollegeWhereInput[] = [publicWhere];
  if (q.kind) filters.push({ kind: q.kind });
  if (q.country) filters.push({ country: { is: { slug: q.country.toLowerCase() } } });
  if (q.state) filters.push({ state: { is: { slug: q.state.toLowerCase() } } });
  if (q.ownership) filters.push({ ownership: q.ownership });
  if (q.minFeeInr !== undefined) filters.push({ totalCourseFeeInr: { gte: q.minFeeInr } });
  if (q.maxFeeInr !== undefined) filters.push({ totalCourseFeeInr: { lte: q.maxFeeInr } });
  if (search) {
    filters.push({ OR: [{ name: { contains: search, mode: "insensitive" } }, { shortName: { contains: search, mode: "insensitive" } }, { city: { contains: search, mode: "insensitive" } }] });
  }
  const where: Prisma.CollegeWhereInput = { AND: filters };
  const orderBy: Prisma.CollegeOrderByWithRelationInput[] =
    q.sort === "fee_asc" ? [{ totalCourseFeeInr: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }]
    : q.sort === "fee_desc" ? [{ totalCourseFeeInr: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }]
    : [{ name: "asc" }, { id: "asc" }];

  const [rows, total, facets] = await Promise.all([
    prisma.college.findMany({ where, include: cardInclude, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.college.count({ where }),
    facetsOf(),
  ]);
  return { items: await cards(rows), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), facets };
}

/** Filter options with counts over ALL listed colleges. */
async function facetsOf() {
  const [byCountry, byState, byOwnership, fee] = await Promise.all([
    prisma.college.groupBy({ by: ["countryId"], where: { AND: [publicWhere, { kind: "ABROAD" }] }, _count: { _all: true } }),
    prisma.college.groupBy({ by: ["stateId"], where: { AND: [publicWhere, { kind: "INDIA" }] }, _count: { _all: true } }),
    prisma.college.groupBy({ by: ["ownership"], where: publicWhere, _count: { _all: true } }),
    prisma.college.aggregate({ where: publicWhere, _min: { totalCourseFeeInr: true }, _max: { totalCourseFeeInr: true } }),
  ]);
  const [countries, states] = await Promise.all([
    prisma.country.findMany({ where: { id: { in: byCountry.map((c) => c.countryId).filter((x): x is string => x !== null) } }, select: { id: true, slug: true, name: true } }),
    prisma.state.findMany({ where: { id: { in: byState.map((s) => s.stateId).filter((x): x is string => x !== null) } }, select: { id: true, slug: true, name: true, code: true } }),
  ]);
  return {
    countries: byCountry
      .map((g) => ({ c: countries.find((x) => x.id === g.countryId), count: g._count._all }))
      .filter((x): x is { c: (typeof countries)[number]; count: number } => Boolean(x.c))
      .map(({ c, count }) => ({ slug: c.slug, name: c.name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    states: byState
      .map((g) => ({ s: states.find((x) => x.id === g.stateId), count: g._count._all }))
      .filter((x): x is { s: (typeof states)[number]; count: number } => Boolean(x.s))
      .map(({ s, count }) => ({ slug: s.slug, name: s.name, code: s.code, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    ownership: byOwnership
      .filter((g): g is typeof g & { ownership: NonNullable<typeof g.ownership> } => g.ownership !== null)
      .map((g) => ({ value: g.ownership, count: g._count._all }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    totalFeeInr: { min: fee._min.totalCourseFeeInr, max: fee._max.totalCourseFeeInr },
  };
}

// ---- page --------------------------------------------------------------------------------------

export async function getPublicCollege(slug: string) {
  const c = await prisma.college.findFirst({
    where: { AND: [publicWhere, { slug: slug.toLowerCase() }] },
    include: {
      ...cardInclude,
      country: { select: { id: true, slug: true, name: true, typicalFlightFromDelhi: true } },
      feeLines: { orderBy: { yearNumber: "asc" }, include: { source: { select: { title: true, url: true } } } },
      sourceLinks: { orderBy: [{ checkedAt: "desc" }, { id: "asc" }], include: { source: { select: { title: true, publisher: true, url: true } } } },
      faqs: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
    },
  });
  if (!c) throw AppError.notFound("We could not find that college.");

  const rateRows = await prisma.fxRate.findMany({ where: { currency: { in: [...new Set(c.feeLines.map((f) => f.currency))] } } });
  const rates = new Map(rateRows.map((r) => [r.currency, num(r.rateToInr)]));
  const usedRates = rateRows.filter((r) => c.feeLines.some((f) => f.currency === r.currency));

  const fees = c.feeLines.map((f) => {
    const a = { yearNumber: f.yearNumber, tuition: num(f.tuition), hostel: num(f.hostel), other: num(f.other), currency: f.currency };
    return {
      ...a, totalLocal: lineTotalLocal(a), rateToInr: f.currency === "INR" ? 1 : (rates.get(f.currency) ?? 0), totalInr: lineTotalInr(a, rates) ?? 0,
      source: f.source ? { title: f.source.title, url: f.source.url } : null, checkedAt: iso(f.checkedAt),
    };
  });

  const notices = (await noticesFor([{ id: c.id, countryId: c.countryId }])).get(c.id) ?? [];
  const i = c.indiaProfile;
  const a = c.abroadProfile;

  const nearbyRows = await prisma.college.findMany({
    where: { AND: [publicWhere, { id: { not: c.id } }, { kind: c.kind }, c.kind === "INDIA" ? { stateId: c.stateId } : { countryId: c.countryId }] },
    include: cardInclude,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 40,
  });
  const nearby = nearbyRows
    .sort((x, y) => Number(y.city === c.city) - Number(x.city === c.city)) // stable: same city first, otherwise A to Z
    .slice(0, 4);

  return {
    slug: c.slug, kind: c.kind, name: c.name, shortName: c.shortName, city: c.city,
    country: c.country ? { slug: c.country.slug, name: c.country.name, typicalFlightFromDelhi: c.country.typicalFlightFromDelhi } : null,
    state: c.state, ownership: c.ownership, establishedYear: c.establishedYear, courseLengthMonths: c.courseLengthMonths,
    description: c.description, heroImageUrl: c.heroImageUrl, websiteUrl: c.websiteUrl, totalCourseFeeInr: c.totalCourseFeeInr,
    feeRatesAsOf: usedRates.length ? dateOnly(new Date(Math.min(...usedRates.map((r) => r.asOf.getTime())))) : null,
    fees,
    india: i
      ? {
          nmcRecognised: i.nmcRecognised, nmcRecognitionCheckedAt: iso(i.nmcRecognitionCheckedAt), mbbsSeats: i.mbbsSeats,
          hospital: { name: i.hospitalName, beds: i.hospitalBeds, dailyOutpatients: i.dailyOutpatients },
          serviceBond: i.serviceBondYears ? { years: i.serviceBondYears, penaltyInr: i.serviceBondPenaltyInr } : null,
          stipendInr: i.stipendInr, domicileRule: i.domicileRule,
        }
      : null,
    abroad: a
      ? {
          wdoms: { status: a.wdomsListed, id: a.wdomsId, url: a.wdomsUrl, checkedAt: iso(a.wdomsCheckedAt) },
          nmc2021: { status: nmc2021Status(a), lengthOk: a.nmcLengthOk, englishOk: a.nmcEnglishOk, internshipOk: a.nmcInternshipOk, checkedAt: iso(a.nmcCheckedAt) },
          teachingLanguage: a.teachingLanguage, languageNote: a.languageNote, internshipMonths: a.internshipMonths, intakeMonths: a.intakeMonths,
          seatsForIndians: a.seatsForIndians, eligibility: (a.eligibility as Record<string, string> | null) ?? null, documents: a.documents,
        }
      : null,
    nmc: {
      alert: alertOf(notices),
      notices: notices.map((n) => ({ title: n.title, url: n.url, publishedAt: n.publishedAt.toISOString(), severity: n.severity, scope: n.scope, checkedAt: n.checkedAt.toISOString() })),
      checkedAt: iso(c.kind === "ABROAD" ? a?.nmcCheckedAt : i?.nmcRecognitionCheckedAt),
    },
    sources: c.sourceLinks.map((s) => ({ purpose: s.purpose, title: s.source.title, publisher: s.source.publisher, url: s.source.url, checkedAt: s.checkedAt.toISOString() })),
    dataCheckedAt: iso(oldestCheck(c as unknown as CardRow)),
    faqs: c.faqs.map((f) => ({ question: f.question, answer: f.answer })),
    nearby: await cards(nearby),
    updatedAt: c.updatedAt.toISOString(),
  };
}
