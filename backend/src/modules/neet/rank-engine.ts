import type { NeetGroup, NeetRankBasis } from "../../generated/prisma/client";

// The rank engine: pure functions, no database, no clock, no randomness. The same input always
// gives byte-identical output (plan §5.1). The service feeds it rows loaded from Postgres.

export const SCORE_MIN = -180;
export const SCORE_MAX = 720;

export type Category = "GENERAL" | "EWS" | "OBC" | "SC" | "ST";
export const CATEGORIES: readonly Category[] = ["GENERAL", "EWS", "OBC", "SC", "ST"];

export const CATEGORY_LABEL: Record<Category, string> = { GENERAL: "General", EWS: "EWS", OBC: "OBC", SC: "SC", ST: "ST" };

/** A count of candidates who scored in [from, to]. A single score has from === to. */
export interface Band {
  from: number;
  to: number;
  candidates: number;
}

export interface RankRowData {
  score: number;
  rankFrom: number;
  rankTo: number;
  spanFrom: number;
  spanTo: number;
  percentile: number;
  candidatesAtScore: number;
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/**
 * Builds the rank row for every integer score from SCORE_MAX down to SCORE_MIN for one group.
 *
 * Exact ties (a band covering one score): students ahead = candidates who scored MORE, so the
 * rank range is [ahead + 1, ahead + candidates at the score]. NTA breaks ties with rules we
 * cannot see, which is why a range is the honest answer.
 *
 * Mark-range bands (from < to): the students in the band are spread evenly over its scores
 * (rounded, deterministic). The estimate is a sub-range of the band's full rank span, and the
 * full span is kept so the API can say how wrong the estimate could be.
 *
 * A score nobody got gets the single rank it would have taken (ahead + 1).
 * Bands must not overlap and must lie inside SCORE_MIN..SCORE_MAX (validated at upload).
 */
export function buildGroupRows(input: readonly Band[]): RankRowData[] {
  const bands = [...input].sort((a, b) => b.from - a.from); // highest scores first
  const total = bands.reduce((sum, b) => sum + b.candidates, 0);
  if (total === 0) return [];

  const rows: RankRowData[] = [];
  let next = 0; // first band that is not yet fully above the current score
  let above = 0; // candidates in bands fully above the current score
  for (let score = SCORE_MAX; score >= SCORE_MIN; score--) {
    while (next < bands.length && bands[next]!.from > score) {
      above += bands[next]!.candidates;
      next++;
    }
    const band = next < bands.length && bands[next]!.to >= score ? bands[next]! : null;

    let rankFrom: number;
    let rankTo: number;
    let spanFrom: number;
    let spanTo: number;
    let count: number;
    if (band) {
      const width = band.to - band.from + 1;
      const ahead = Math.round(((band.to - score) * band.candidates) / width);
      const through = Math.round(((band.to - score + 1) * band.candidates) / width);
      count = through - ahead;
      spanFrom = above + 1;
      spanTo = Math.max(spanFrom, above + band.candidates);
      // A score inside a band always lands inside the band's rank span, even when rounding
      // gives it zero students.
      rankFrom = Math.min(above + ahead + 1, spanTo);
      rankTo = Math.min(Math.max(rankFrom, above + through), spanTo);
    } else {
      count = 0;
      rankFrom = rankTo = spanFrom = spanTo = above + 1;
    }
    rows.push({ score, rankFrom, rankTo, spanFrom, spanTo, percentile: round7((100 * (total - (rankFrom - 1))) / total), candidatesAtScore: count });
  }
  return rows;
}

/** Year basis: exact if every count is for a single score, otherwise band interpolation. */
export function basisOf(bandsByGroup: Iterable<readonly Band[]>): NeetRankBasis {
  for (const bands of bandsByGroup) if (bands.some((b) => b.from !== b.to)) return "BAND_INTERPOLATION";
  return "EXACT_TIES";
}

// ---- qualification ---------------------------------------------------------------------

export interface Cutoff {
  minScore: number;
  percentile: number;
}

export interface Qualification {
  /** null = the year has no cut-off loaded for this category, so we cannot say. */
  qualified: boolean | null;
  cutoffScore: number | null;
  cutoffPercentile: number | null;
  /** Which cut-off decided it. */
  appliedGroup: NeetGroup | null;
}

/**
 * A PwD student qualifies at the lower of their category cut-off and the PwD cut-off
 * (NTA: General/EWS 50th percentile, PwD 45th, OBC/SC/ST 40th). The PwD list therefore only
 * ever helps General/EWS students; OBC/SC/ST already sit at or below it.
 */
export function qualify(score: number, category: Category, pwd: boolean, cutoffs: ReadonlyMap<NeetGroup, Cutoff>): Qualification {
  const own = cutoffs.get(category);
  if (!own) return { qualified: null, cutoffScore: null, cutoffPercentile: null, appliedGroup: null };
  let applied: NeetGroup = category;
  let best = own;
  const pwdCutoff = pwd ? cutoffs.get("PWD") : undefined;
  if (pwdCutoff && pwdCutoff.minScore < best.minScore) {
    applied = "PWD";
    best = pwdCutoff;
  }
  return { qualified: score >= best.minScore, cutoffScore: best.minScore, cutoffPercentile: best.percentile, appliedGroup: applied };
}

// ---- result ----------------------------------------------------------------------------

export interface RankRange {
  from: number;
  to: number;
}

export interface RankInput {
  score: number;
  category: Category;
  pwd: boolean;
}

export interface YearFacts {
  year: number;
  appeared: number;
  basis: NeetRankBasis;
  cutoffs: ReadonlyMap<NeetGroup, Cutoff>;
}

export interface RankRows {
  overall: RankRowData | undefined;
  category: RankRowData | undefined;
  pwd: RankRowData | undefined;
}

export type RankOutcome = "OK" | "BELOW_CUTOFF" | "NOT_PUBLISHED_BY_NTA";

export interface RankResult {
  year: number;
  outcome: RankOutcome;
  score: number;
  category: Category;
  pwd: boolean;
  qualification: Qualification;
  allIndiaRank: RankRange | null;
  possibleRankSpan: RankRange | null;
  categoryRank: RankRange | null;
  pwdRank: RankRange | null;
  percentile: number | null;
  studentsAhead: number | null;
  studentsAppeared: number;
  studentsWithSameScore: number | null;
  approximate: boolean;
  /** null when NTA published no score counts for the year. */
  basis: NeetRankBasis | null;
  explanation: string[];
}

const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const range = (r: RankRange) => (r.from === r.to ? fmt(r.from) : `${fmt(r.from)} to ${fmt(r.to)}`);
/** Percentile for display: two decimals, no trailing zeros. */
const pct = (n: number) => String(Math.round(n * 100) / 100);
const toRange = (r: RankRowData): RankRange => ({ from: r.rankFrom, to: r.rankTo });

/**
 * A year where NTA published only totals and cut-offs: no rank can be worked out, but we can still
 * say whether the score qualifies. Never an estimate.
 */
export function buildNoRankDataResult(input: RankInput, year: { year: number; appeared: number; cutoffs: ReadonlyMap<NeetGroup, Cutoff> }): RankResult {
  const { score, category, pwd } = input;
  const qualification = qualify(score, category, pwd, year.cutoffs);
  const explanation = [`NTA did not publish how many students got each score in NEET (UG) ${year.year}. It published only totals and the qualifying cut-offs, so we cannot work out a rank from a score for this year.`];
  if (qualification.qualified !== null) {
    const who = qualification.appliedGroup === "PWD" ? "PwD students" : `${CATEGORY_LABEL[category]} students`;
    explanation.push(
      `The ${year.year} qualifying cut-off for ${who} was ${fmt(qualification.cutoffScore!)} marks (${qualification.cutoffPercentile} percentile). Your score is ${qualification.qualified ? "at or above" : "below"} it.`,
    );
  }
  return {
    year: year.year,
    outcome: "NOT_PUBLISHED_BY_NTA",
    score,
    category,
    pwd,
    qualification,
    allIndiaRank: null,
    possibleRankSpan: null,
    categoryRank: null,
    pwdRank: null,
    percentile: null,
    studentsAhead: null,
    studentsAppeared: year.appeared,
    studentsWithSameScore: null,
    approximate: false,
    basis: null,
    explanation,
  };
}

/** Turns the loaded rows into the answer a student sees, with plain-words explanation bullets. */
export function buildRankResult(input: RankInput, year: YearFacts, rows: RankRows): RankResult {
  if (!rows.overall) throw new Error(`No All-India rank row for ${year.year} score ${input.score}`);
  const { score, category, pwd } = input;
  const qualification = qualify(score, category, pwd, year.cutoffs);
  const base = { year: year.year, score, category, pwd, qualification, studentsAppeared: year.appeared, basis: year.basis };
  const catLabel = CATEGORY_LABEL[category];

  const explanation: string[] = [`We worked out your rank from NEET (UG) ${year.year} score data. The "Data we use" table shows where it comes from and how it was built.`];
  if (qualification.qualified !== null) {
    const cut = `The ${year.year} qualifying cut-off for ${qualification.appliedGroup === "PWD" ? "PwD students" : `${catLabel} students`} was ${fmt(qualification.cutoffScore!)} marks (${qualification.cutoffPercentile} percentile).`;
    explanation.push(qualification.qualified ? `${cut} Your score is at or above it.` : `${cut} Your score is below it, so this score does not qualify and we do not show a rank.`);
  }

  if (qualification.qualified === false) {
    return {
      ...base,
      outcome: "BELOW_CUTOFF",
      allIndiaRank: null,
      possibleRankSpan: null,
      categoryRank: null,
      pwdRank: null,
      percentile: null,
      studentsAhead: null,
      studentsWithSameScore: null,
      approximate: false,
      explanation,
    };
  }

  const o = rows.overall;
  const allIndiaRank = toRange(o);
  const span: RankRange = { from: o.spanFrom, to: o.spanTo };
  const approximate = year.basis === "BAND_INTERPOLATION" && (span.from !== allIndiaRank.from || span.to !== allIndiaRank.to);
  const categoryRank = rows.category ? toRange(rows.category) : null;
  const pwdRank = pwd && rows.pwd ? toRange(rows.pwd) : null;

  if (approximate) {
    explanation.push(
      `For ${year.year}, NTA published student counts for mark ranges, not for every single score. We spread the students in each range evenly to estimate your rank, so treat it as approximate. Your rank could be anywhere from ${fmt(span.from)} to ${fmt(span.to)}.`,
    );
  } else if (o.candidatesAtScore > 1) {
    explanation.push(
      `${fmt(o.candidatesAtScore)} students scored exactly ${fmt(score)}. NTA separates tied students with tie-break rules that are not public, so we show a range instead of one number.`,
    );
  } else if (o.candidatesAtScore === 1) {
    explanation.push(`Only one student scored exactly ${fmt(score)}, so this rank is exact.`);
  } else {
    explanation.push(`No student scored exactly ${fmt(score)} in ${year.year}. The rank shown is the place this score would have taken.`);
  }

  const ahead = allIndiaRank.from - 1;
  explanation.push(
    `${approximate ? "About " : ""}${fmt(ahead)} students scored higher than this, out of ${fmt(year.appeared)} who appeared.`,
    `Your percentile is ${pct(o.percentile)}: about ${pct(o.percentile)}% of students scored the same or lower.`,
  );
  if (categoryRank) explanation.push(`Among ${catLabel} students, your rank is ${range(categoryRank)}.`);
  else explanation.push(`Category-wise data is not available for ${year.year}, so we do not show a ${catLabel} rank.`);
  if (pwd) explanation.push(pwdRank ? `Among PwD students, your rank is ${range(pwdRank)}.` : `A separate PwD rank list is not available for ${year.year}.`);

  return {
    ...base,
    outcome: "OK",
    allIndiaRank,
    possibleRankSpan: approximate ? span : null,
    categoryRank,
    pwdRank,
    percentile: o.percentile,
    studentsAhead: ahead,
    studentsWithSameScore: approximate ? null : o.candidatesAtScore,
    approximate,
    explanation,
  };
}
