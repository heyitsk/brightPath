import { createHash } from "node:crypto";
import type { NeetExamYear, NeetGroup, NeetQualifyingCutoff, NeetRankBasis, Source } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { AppError, type FieldError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { optionalText, parsePastDate } from "../reference/reference.schemas";
import { getPublicSiteConfig } from "../site/site.service";
import {
  CUTOFF_GROUPS,
  GROUPS,
  REQUIRED_CUTOFF_GROUPS,
  consistencyWarnings,
  groupBands,
  parseDistributionCsv,
  summariseGroups,
  type GroupSummary,
} from "./distribution";
import { basisOf, buildGroupRows, buildRankResult, type Category, type Cutoff, type RankInput, type RankResult, type RankRowData } from "./rank-engine";

// NEET (UG) rank data: staff-side year management plus the public rank lookup.
// Public answers come only from PUBLISHED years; the derived rank table is rebuilt by code on
// every score-count upload and is never edited by hand.

const NS = "neet";
const CACHE_TTL_SEC = 3600; // publish/unpublish bump the namespace, so this is only a ceiling

type YearRow = NeetExamYear & { source: Source; cutoffs: NeetQualifyingCutoff[] };
const include = { source: true, cutoffs: true } as const;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const versionOf = (year: number, hash: string | null) => (hash ? `${year}-${hash.slice(0, 12)}` : null);
const groupOrder = (g: NeetGroup) => GROUPS.indexOf(g);
const sourceRef = (s: Source) => ({ title: s.title, publisher: s.publisher, url: s.url });

// ---- admin: DTOs -----------------------------------------------------------------------

export function toYearDto(y: YearRow) {
  return {
    id: y.id,
    year: y.year,
    status: y.status,
    appeared: y.appeared,
    qualified: y.qualified,
    topperScore: y.topperScore,
    resultDate: dateOnly(y.resultDate),
    basis: y.basis,
    methodNote: y.methodNote,
    source: { id: y.source.id, kind: y.source.kind, title: y.source.title, publisher: y.source.publisher, url: y.source.url },
    checkedAt: y.checkedAt.toISOString(),
    distribution: y.distributionSha256 ? { fileName: y.distributionFileName, sha256: y.distributionSha256, uploadedAt: y.distributionUploadedAt!.toISOString() } : null,
    tableVersion: versionOf(y.year, y.tableHash),
    cutoffs: [...y.cutoffs].sort((a, b) => groupOrder(a.group) - groupOrder(b.group)).map((c) => ({ group: c.group, percentile: c.percentile, minScore: c.minScore })),
    publishedAt: y.publishedAt?.toISOString() ?? null,
    createdAt: y.createdAt.toISOString(),
    updatedAt: y.updatedAt.toISOString(),
  };
}

async function findYear(year: number): Promise<YearRow> {
  const y = await prisma.neetExamYear.findUnique({ where: { year }, include });
  if (!y) throw AppError.notFound(`There is no NEET (UG) ${year} record.`);
  return y;
}

async function loadBands(examYearId: string) {
  const rows = await prisma.neetScoreDistribution.findMany({ where: { examYearId } });
  return groupBands(rows.map((r) => ({ group: r.group, from: r.scoreFrom, to: r.scoreTo, candidates: r.candidates })));
}

function publishProblems(y: YearRow, groups: readonly GroupSummary[]): string[] {
  const problems: string[] = [];
  if (!y.distributionSha256 || !groups.some((g) => g.group === "OVERALL")) problems.push("Upload the score-count file (it must include the OVERALL list).");
  const have = new Set(y.cutoffs.map((c) => c.group));
  const missing = REQUIRED_CUTOFF_GROUPS.filter((g) => !have.has(g));
  if (missing.length > 0) problems.push(`Add the qualifying cut-off for: ${missing.join(", ")}.`);
  return problems;
}

async function toDetail(y: YearRow) {
  const bands = await loadBands(y.id);
  const groups = summariseGroups(bands);
  return {
    ...toYearDto(y),
    groups,
    warnings: groups.length > 0 ? consistencyWarnings(groups, { appeared: y.appeared, topperScore: y.topperScore }) : [],
    publishProblems: publishProblems(y, groups),
  };
}

// ---- admin: years ----------------------------------------------------------------------

export async function listYears() {
  const rows = await prisma.neetExamYear.findMany({ include, orderBy: { year: "desc" } });
  return { items: rows.map(toYearDto) };
}

export async function getYearDetail(year: number) {
  return toDetail(await findYear(year));
}

interface YearNumbers {
  appeared?: number;
  qualified?: number | null;
  topperScore?: number | null;
}

function checkYearNumbers(n: YearNumbers) {
  const errors: FieldError[] = [];
  if (n.appeared !== undefined && n.qualified != null && n.qualified > n.appeared) {
    errors.push({ path: "qualified", message: "The number who qualified cannot be more than the number who appeared." });
  }
  if (errors.length > 0) throw AppError.invalid(`Please fix ${errors.length} thing${errors.length === 1 ? "" : "s"} below.`, errors);
}

async function assertSourceExists(sourceId: string) {
  if (!(await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } }))) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "sourceId", message: "There is no source with this id. Add the official NTA document under Sources first." }]);
  }
}

export async function createYear(
  actor: AuditActor,
  input: { year: number; appeared: number; qualified?: number | null; topperScore?: number | null; resultDate?: string | null; methodNote?: string | null; sourceId: string; checkedAt: string },
) {
  if (await prisma.neetExamYear.findUnique({ where: { year: input.year }, select: { id: true } })) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "year", message: `NEET (UG) ${input.year} already exists.` }]);
  }
  checkYearNumbers(input);
  await assertSourceExists(input.sourceId);
  const created = await prisma.$transaction(async (tx) => {
    const y = await tx.neetExamYear.create({
      data: {
        year: input.year,
        appeared: input.appeared,
        qualified: input.qualified ?? null,
        topperScore: input.topperScore ?? null,
        resultDate: input.resultDate ? parsePastDate("resultDate", input.resultDate) : null,
        methodNote: optionalText(input.methodNote) ?? null,
        sourceId: input.sourceId,
        checkedAt: parsePastDate("checkedAt", input.checkedAt),
        createdById: actor.id,
      },
      include,
    });
    await audit(tx, { actor, action: "neet_year.create", entityType: "NeetExamYear", entityId: y.id, after: toYearDto(y) });
    return y;
  });
  return toDetail(created);
}

const LIVE_EDITABLE = new Set(["checkedAt", "methodNote"]);

export async function updateYear(
  actor: AuditActor,
  year: number,
  input: { appeared?: number; qualified?: number | null; topperScore?: number | null; resultDate?: string | null; methodNote?: string | null; sourceId?: string; checkedAt?: string },
) {
  const before = await findYear(year);
  const touched = Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k);
  const locked = touched.filter((k) => !LIVE_EDITABLE.has(k));
  if (before.status === "PUBLISHED" && locked.length > 0) {
    throw AppError.conflict(`NEET (UG) ${year} is published. Unpublish it to change: ${locked.join(", ")}. (Only checkedAt and methodNote can change while published.)`);
  }
  checkYearNumbers({ appeared: input.appeared ?? before.appeared, qualified: input.qualified === undefined ? before.qualified : input.qualified });
  if (input.sourceId !== undefined) await assertSourceExists(input.sourceId);

  const updated = await prisma.$transaction(async (tx) => {
    const y = await tx.neetExamYear.update({
      where: { year },
      include,
      data: {
        ...(input.appeared !== undefined ? { appeared: input.appeared } : {}),
        ...(input.qualified !== undefined ? { qualified: input.qualified } : {}),
        ...(input.topperScore !== undefined ? { topperScore: input.topperScore } : {}),
        ...(input.resultDate !== undefined ? { resultDate: input.resultDate ? parsePastDate("resultDate", input.resultDate) : null } : {}),
        ...(input.methodNote !== undefined ? { methodNote: optionalText(input.methodNote) } : {}),
        ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        ...(input.checkedAt !== undefined ? { checkedAt: parsePastDate("checkedAt", input.checkedAt) } : {}),
      },
    });
    await audit(tx, { actor, action: "neet_year.update", entityType: "NeetExamYear", entityId: y.id, before: toYearDto(before), after: toYearDto(y) });
    return y;
  });
  if (before.status === "PUBLISHED") await invalidate(NS);
  return toDetail(updated);
}

export async function deleteYear(actor: AuditActor, year: number) {
  const before = await findYear(year);
  if (before.status === "PUBLISHED") throw AppError.conflict(`NEET (UG) ${year} is published. Unpublish it before deleting.`);
  await prisma.$transaction(async (tx) => {
    await tx.neetExamYear.delete({ where: { year } }); // cutoffs, counts and rank rows cascade
    await audit(tx, { actor, action: "neet_year.delete", entityType: "NeetExamYear", entityId: before.id, before: toYearDto(before) });
  });
}

export async function setCutoffs(actor: AuditActor, year: number, cutoffs: Array<{ group: NeetGroup; percentile: number; minScore: number }>) {
  const before = await findYear(year);
  if (before.status === "PUBLISHED") throw AppError.conflict(`NEET (UG) ${year} is published. Unpublish it to change the cut-offs.`);
  const seen = new Set<string>();
  const errors: FieldError[] = [];
  cutoffs.forEach((c, i) => {
    if (!CUTOFF_GROUPS.includes(c.group as (typeof CUTOFF_GROUPS)[number])) errors.push({ path: `cutoffs.${i}.group`, message: "Choose GENERAL, EWS, OBC, SC, ST or PWD." });
    else if (seen.has(c.group)) errors.push({ path: `cutoffs.${i}.group`, message: `${c.group} is listed twice.` });
    seen.add(c.group);
  });
  if (errors.length > 0) throw AppError.invalid(`Please fix ${errors.length} thing${errors.length === 1 ? "" : "s"} below.`, errors);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.neetQualifyingCutoff.deleteMany({ where: { examYearId: before.id } });
    await tx.neetQualifyingCutoff.createMany({ data: cutoffs.map((c) => ({ examYearId: before.id, group: c.group, percentile: c.percentile, minScore: c.minScore })) });
    const y = await tx.neetExamYear.findUniqueOrThrow({ where: { year }, include });
    await audit(tx, { actor, action: "neet_year.set_cutoffs", entityType: "NeetExamYear", entityId: y.id, before: { cutoffs: toYearDto(before).cutoffs }, after: { cutoffs: toYearDto(y).cutoffs } });
    return y;
  });
  return toDetail(updated);
}

// ---- admin: score-count upload ---------------------------------------------------------

function hashTable(tables: ReadonlyMap<NeetGroup, RankRowData[]>): string {
  const h = createHash("sha256");
  for (const g of GROUPS) {
    const rows = tables.get(g);
    if (!rows) continue;
    h.update(g);
    for (const r of rows) h.update(`|${r.score},${r.rankFrom},${r.rankTo},${r.spanFrom},${r.spanTo},${r.percentile},${r.candidatesAtScore}`);
  }
  return h.digest("hex");
}

async function createInChunks<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/**
 * Validates the CSV, builds the derived rank table for every group and (unless `dryRun`) replaces
 * the year's counts and rank rows in one transaction. The rank table depends only on the counts,
 * so it can never be out of date.
 */
export async function uploadDistribution(actor: AuditActor, year: number, input: { csv: string; fileName?: string | null; dryRun?: boolean }) {
  const y = await findYear(year);
  if (y.status === "PUBLISHED") throw AppError.conflict(`NEET (UG) ${year} is published. Unpublish it before replacing its data.`);

  const rows = parseDistributionCsv(input.csv);
  const bands = groupBands(rows);
  const tables = new Map<NeetGroup, RankRowData[]>();
  for (const g of GROUPS) {
    const b = bands.get(g);
    if (b) tables.set(g, buildGroupRows(b));
  }
  const basis: NeetRankBasis = basisOf(bands.values());
  const groups = summariseGroups(bands);
  const tableHash = hashTable(tables);
  const report = {
    dryRun: input.dryRun ?? false,
    basis,
    groups,
    warnings: consistencyWarnings(groups, { appeared: y.appeared, topperScore: y.topperScore }),
    rankRowsBuilt: [...tables.values()].reduce((n, t) => n + t.length, 0),
    tableVersion: versionOf(year, tableHash)!,
  };
  if (input.dryRun) return report;

  const sha256 = createHash("sha256").update(input.csv).digest("hex");
  const fileName = optionalText(input.fileName) ?? null;
  await prisma.$transaction(
    async (tx) => {
      await tx.neetScoreDistribution.deleteMany({ where: { examYearId: y.id } });
      await tx.neetRankRow.deleteMany({ where: { examYearId: y.id } });
      await createInChunks(rows, 2000, (chunk) =>
        tx.neetScoreDistribution.createMany({ data: chunk.map((r) => ({ examYearId: y.id, group: r.group, scoreFrom: r.from, scoreTo: r.to, candidates: r.candidates })) }),
      );
      const rankRows = [...tables.entries()].flatMap(([group, list]) => list.map((r) => ({ examYearId: y.id, group, ...r })));
      await createInChunks(rankRows, 2000, (chunk) =>
        tx.neetRankRow.createMany({
          data: chunk.map((r) => ({
            examYearId: r.examYearId,
            group: r.group,
            score: r.score,
            rankFrom: r.rankFrom,
            rankTo: r.rankTo,
            spanFrom: r.spanFrom,
            spanTo: r.spanTo,
            percentile: r.percentile,
            candidatesAtScore: r.candidatesAtScore,
          })),
        }),
      );
      await tx.neetExamYear.update({
        where: { id: y.id },
        data: { basis, tableHash, distributionFileName: fileName, distributionSha256: sha256, distributionUploadedAt: new Date() },
      });
      await audit(tx, {
        actor,
        action: "neet_year.upload_distribution",
        entityType: "NeetExamYear",
        entityId: y.id,
        before: { sha256: y.distributionSha256, tableVersion: versionOf(year, y.tableHash) },
        after: { year, fileName, sha256, rows: rows.length, basis, tableVersion: report.tableVersion, warnings: report.warnings.length },
      });
    },
    { timeout: 60_000 },
  );
  return report;
}

// ---- admin: publish --------------------------------------------------------------------

export async function publishYear(actor: AuditActor, year: number) {
  const y = await findYear(year);
  if (y.status === "PUBLISHED") throw AppError.conflict(`NEET (UG) ${year} is already published.`);
  const problems = publishProblems(y, summariseGroups(await loadBands(y.id)));
  if (problems.length > 0) {
    throw AppError.invalid(`NEET (UG) ${year} is not ready to publish. Please fix ${problems.length} thing${problems.length === 1 ? "" : "s"}.`, problems.map((message) => ({ path: "year", message })));
  }
  const published = await prisma.$transaction(async (tx) => {
    const p = await tx.neetExamYear.update({ where: { year }, data: { status: "PUBLISHED", publishedAt: new Date() }, include });
    await audit(tx, { actor, action: "neet_year.publish", entityType: "NeetExamYear", entityId: p.id, before: { status: y.status }, after: { status: p.status, tableVersion: versionOf(year, p.tableHash) } });
    return p;
  });
  await invalidate(NS);
  return toDetail(published);
}

export async function unpublishYear(actor: AuditActor, year: number) {
  const y = await findYear(year);
  if (y.status !== "PUBLISHED") throw AppError.conflict(`NEET (UG) ${year} is not published.`);
  const draft = await prisma.$transaction(async (tx) => {
    const d = await tx.neetExamYear.update({ where: { year }, data: { status: "DRAFT", publishedAt: null }, include });
    await audit(tx, { actor, action: "neet_year.unpublish", entityType: "NeetExamYear", entityId: d.id, before: { status: y.status }, after: { status: d.status } });
    return d;
  });
  await invalidate(NS);
  return toDetail(draft);
}

// ---- rank lookup (public + admin preview) ----------------------------------------------

interface LoadedYear {
  id: string;
  year: number;
  appeared: number;
  qualified: number | null;
  topperScore: number | null;
  resultDate: string | null;
  basis: NeetRankBasis;
  methodNote: string | null;
  checkedAt: string;
  tableVersion: string;
  source: { title: string; publisher: string | null; url: string | null };
  cutoffs: Array<{ group: NeetGroup; percentile: number; minScore: number }>;
  groups: NeetGroup[];
}

async function toLoaded(rows: YearRow[]): Promise<LoadedYear[]> {
  const present = await prisma.neetScoreDistribution.groupBy({ by: ["examYearId", "group"], where: { examYearId: { in: rows.map((r) => r.id) } } });
  return rows.map((y) => ({
    id: y.id,
    year: y.year,
    appeared: y.appeared,
    qualified: y.qualified,
    topperScore: y.topperScore,
    resultDate: dateOnly(y.resultDate),
    basis: y.basis!,
    methodNote: y.methodNote,
    checkedAt: y.checkedAt.toISOString(),
    tableVersion: versionOf(y.year, y.tableHash)!,
    source: sourceRef(y.source),
    cutoffs: toYearDto(y).cutoffs,
    groups: present.filter((p) => p.examYearId === y.id).map((p) => p.group).sort((a, b) => groupOrder(a) - groupOrder(b)),
  }));
}

const loadPublished = () =>
  cached(NS, "years", CACHE_TTL_SEC, async () => toLoaded(await prisma.neetExamYear.findMany({ where: { status: "PUBLISHED", basis: { not: null } }, include, orderBy: { year: "desc" } })));

/** One year's answer for one input: the engine result plus provenance. */
async function resultFor(y: LoadedYear, input: RankInput) {
  const wanted: NeetGroup[] = ["OVERALL", input.category, ...(input.pwd ? (["PWD"] as const) : [])];
  const rows = await prisma.neetRankRow.findMany({ where: { examYearId: y.id, score: input.score, group: { in: wanted } } });
  const pick = (g: NeetGroup): RankRowData | undefined => rows.find((r) => r.group === g);
  const cutoffs = new Map<NeetGroup, Cutoff>(y.cutoffs.map((c) => [c.group, { minScore: c.minScore, percentile: c.percentile }]));
  const result: RankResult = buildRankResult(input, { year: y.year, appeared: y.appeared, basis: y.basis, cutoffs }, { overall: pick("OVERALL"), category: pick(input.category), pwd: pick("PWD") });
  return { ...result, source: y.source, checkedAt: y.checkedAt, tableVersion: y.tableVersion };
}

async function metaFresh() {
  const d = (await getPublicSiteConfig()).disclaimers["NOT_GUARANTEED"]!;
  return { disclaimer: { key: "NOT_GUARANTEED", version: d.version, text: d.text } };
}

export interface RankQuery {
  score: number;
  category: Category;
  pwd?: boolean;
  year?: number;
}

export async function getRank(q: RankQuery) {
  const years = await loadPublished();
  if (years.length === 0) throw AppError.notFound("NEET rank data has not been published yet.");
  const chosen = q.year === undefined ? years[0]! : years.find((y) => y.year === q.year);
  if (!chosen) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "year", message: `We do not have NEET (UG) ${q.year} data. Available years: ${years.map((y) => y.year).join(", ")}.` }]);
  }
  const input: RankInput = { score: q.score, category: q.category, pwd: q.pwd ?? false };
  const body = await cached(NS, `rank:${chosen.year}:${input.score}:${input.category}:${input.pwd}`, CACHE_TTL_SEC, async () => {
    const result = await resultFor(chosen, input);
    const otherYears = [];
    for (const other of years.filter((y) => y.year !== chosen.year)) {
      const r = await resultFor(other, input);
      otherYears.push({ year: r.year, outcome: r.outcome, allIndiaRank: r.allIndiaRank, approximate: r.approximate, basis: r.basis });
    }
    return { result, otherYears };
  });
  return { ...body, meta: await metaFresh() };
}

/** Staff check of a draft year before publishing: same engine, no cache, any status. */
export async function previewRank(year: number, q: Omit<RankQuery, "year">) {
  const y = await findYear(year);
  if (!y.basis || !y.tableHash) throw AppError.conflict(`Upload the score-count file for NEET (UG) ${year} first.`);
  const [loaded] = await toLoaded([y]);
  const result = await resultFor(loaded!, { score: q.score, category: q.category, pwd: q.pwd ?? false });
  return { result, otherYears: [], meta: await metaFresh() };
}

export async function getDataSources() {
  const years = await cached(NS, "data-sources", CACHE_TTL_SEC, async () =>
    (await loadPublished()).map((y) => ({
      year: y.year,
      appeared: y.appeared,
      qualified: y.qualified,
      topperScore: y.topperScore,
      resultDate: y.resultDate,
      basis: y.basis,
      approximate: y.basis === "BAND_INTERPOLATION",
      methodNote: y.methodNote,
      groups: y.groups,
      cutoffs: y.cutoffs,
      source: y.source,
      checkedAt: y.checkedAt,
      tableVersion: y.tableVersion,
    })),
  );
  return { years, meta: await metaFresh() };
}
