import type { NeetGroup } from "../../generated/prisma/client";
import { AppError, type FieldError } from "../../lib/errors";
import { SCORE_MAX, SCORE_MIN, type Band } from "./rank-engine";

// Score-count upload (CSV text). One format for every NTA year, whatever the source looked
// like: staff (or a script) turn the official file into rows of
//
//   group,score_from,score_to,candidates
//   OVERALL,720,720,3
//   OVERALL,715,715,11
//   OBC,600,609,5120        <- a mark range: score_to is the top of the range
//
// `score_to` may be left blank for a single score. Plain digits only (no thousands commas).

export const GROUPS = ["OVERALL", "GENERAL", "EWS", "OBC", "SC", "ST", "PWD"] as const satisfies readonly NeetGroup[];
export const CUTOFF_GROUPS = ["GENERAL", "EWS", "OBC", "SC", "ST", "PWD"] as const satisfies readonly NeetGroup[];
/** Cut-offs a year must have before it can be published (PwD is optional). */
export const REQUIRED_CUTOFF_GROUPS = ["GENERAL", "EWS", "OBC", "SC", "ST"] as const satisfies readonly NeetGroup[];

export const CSV_HEADER = "group,score_from,score_to,candidates";
export const MAX_CSV_ROWS = 20_000;
const MAX_ERRORS = 20;

export interface DistributionRow extends Band {
  group: NeetGroup;
}

const GROUP_SET = new Set<string>(GROUPS);
const bad = (errors: FieldError[], message: string) => {
  if (errors.length < MAX_ERRORS) errors.push({ path: "csv", message });
};

/** Parses and validates the CSV. Throws a 422 listing up to 20 problems (with line numbers). */
export function parseDistributionCsv(text: string): DistributionRow[] {
  const errors: FieldError[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const rows: DistributionRow[] = [];
  const lineOf = new Map<DistributionRow, number>();
  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const n = i + 1;
    if (!headerSeen) {
      headerSeen = true;
      if (line.toLowerCase().replaceAll(" ", "") !== CSV_HEADER) {
        throw AppError.invalid("Please fix 1 thing below.", [{ path: "csv", message: `Line ${n}: the first line must be exactly "${CSV_HEADER}".` }]);
      }
      continue;
    }
    if (rows.length >= MAX_CSV_ROWS) {
      throw AppError.invalid("Please fix 1 thing below.", [{ path: "csv", message: `Too many rows. The limit is ${MAX_CSV_ROWS}.` }]);
    }
    if (line.includes('"')) {
      bad(errors, `Line ${n}: quotes are not allowed. Use plain values separated by commas.`);
      continue;
    }
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length !== 4) {
      bad(errors, `Line ${n}: expected 4 values (${CSV_HEADER}) but found ${cells.length}.`);
      continue;
    }
    const [groupRaw, fromRaw, toRaw, countRaw] = cells as [string, string, string, string];
    const group = groupRaw.toUpperCase();
    if (!GROUP_SET.has(group)) {
      bad(errors, `Line ${n}: group "${groupRaw}" is not one of ${GROUPS.join(", ")}.`);
      continue;
    }
    const intOk = (v: string) => /^-?\d+$/.test(v);
    if (!intOk(fromRaw) || (toRaw !== "" && !intOk(toRaw))) {
      bad(errors, `Line ${n}: scores must be whole numbers.`);
      continue;
    }
    if (!/^\d+$/.test(countRaw) || countRaw.length > 9) {
      bad(errors, `Line ${n}: candidates must be a whole number from 0 up, written with digits only (no commas).`);
      continue;
    }
    const from = Number(fromRaw);
    const to = toRaw === "" ? from : Number(toRaw);
    if (from > to) {
      bad(errors, `Line ${n}: score_from (${from}) is higher than score_to (${to}).`);
      continue;
    }
    if (from < SCORE_MIN || to > SCORE_MAX) {
      bad(errors, `Line ${n}: scores must be between ${SCORE_MIN} and ${SCORE_MAX}.`);
      continue;
    }
    const row: DistributionRow = { group: group as NeetGroup, from, to, candidates: Number(countRaw) };
    rows.push(row);
    lineOf.set(row, n);
  }

  if (!headerSeen) errors.push({ path: "csv", message: `The file is empty. The first line must be "${CSV_HEADER}".` });
  else if (rows.length === 0 && errors.length === 0) errors.push({ path: "csv", message: "The file has a header but no data rows." });

  // Overlaps and duplicates inside one group make the ranks meaningless, so refuse them.
  for (const group of GROUPS) {
    const mine = rows.filter((r) => r.group === group).sort((a, b) => a.from - b.from);
    for (let i = 1; i < mine.length; i++) {
      const prev = mine[i - 1]!;
      const cur = mine[i]!;
      if (cur.from <= prev.to) {
        bad(errors, `Line ${lineOf.get(cur)}: ${group} scores ${cur.from}–${cur.to} overlap scores ${prev.from}–${prev.to} (line ${lineOf.get(prev)}).`);
      }
    }
  }
  if (rows.length > 0 && !rows.some((r) => r.group === "OVERALL" && r.candidates > 0)) {
    errors.push({ path: "csv", message: "The file needs OVERALL rows with at least one candidate: they are the All-India list." });
  }

  if (errors.length > 0) {
    const more = errors.length >= MAX_ERRORS ? " (showing the first 20)" : "";
    throw AppError.invalid(`Please fix ${errors.length}${errors.length >= MAX_ERRORS ? "+" : ""} thing${errors.length === 1 ? "" : "s"} in the file${more}.`, errors);
  }
  return rows;
}

export function groupBands(rows: readonly DistributionRow[]): Map<NeetGroup, Band[]> {
  const out = new Map<NeetGroup, Band[]>();
  for (const r of rows) {
    const list = out.get(r.group) ?? [];
    list.push({ from: r.from, to: r.to, candidates: r.candidates });
    out.set(r.group, list);
  }
  return out;
}

export interface GroupSummary {
  group: NeetGroup;
  rows: number;
  /** Rows that cover more than one score. */
  bands: number;
  candidates: number;
  /** Lowest and highest score that has at least one candidate. */
  lowestScore: number | null;
  highestScore: number | null;
}

export function summariseGroups(bandsByGroup: ReadonlyMap<NeetGroup, readonly Band[]>): GroupSummary[] {
  return GROUPS.filter((g) => bandsByGroup.has(g)).map((group) => {
    const bands = bandsByGroup.get(group)!;
    const filled = bands.filter((b) => b.candidates > 0);
    return {
      group,
      rows: bands.length,
      bands: bands.filter((b) => b.from !== b.to).length,
      candidates: bands.reduce((s, b) => s + b.candidates, 0),
      lowestScore: filled.length ? Math.min(...filled.map((b) => b.from)) : null,
      highestScore: filled.length ? Math.max(...filled.map((b) => b.to)) : null,
    };
  });
}

/** Cross-checks that hint at a wrong file. They never block an upload; staff decide. */
export function consistencyWarnings(groups: readonly GroupSummary[], year: { appeared: number; topperScore: number | null }): string[] {
  const warnings: string[] = [];
  const total = (g: NeetGroup) => groups.find((s) => s.group === g)?.candidates;
  const overall = total("OVERALL")!;
  if (overall !== year.appeared) {
    warnings.push(`The All-India list adds up to ${overall} candidates but the year says ${year.appeared} appeared. Check the file and the "appeared" figure.`);
  }
  const cats = (["GENERAL", "EWS", "OBC", "SC", "ST"] as const).map(total);
  if (cats.every((c) => c !== undefined)) {
    const sum = cats.reduce((a, b) => a + b!, 0);
    if (sum !== overall) warnings.push(`The five categories add up to ${sum} candidates but the All-India list has ${overall}.`);
  }
  for (const g of groups) {
    if (g.group !== "OVERALL" && g.candidates > overall) warnings.push(`${g.group} has more candidates (${g.candidates}) than the All-India list (${overall}).`);
  }
  const top = groups.find((g) => g.group === "OVERALL")?.highestScore;
  if (year.topperScore !== null && top !== null && top !== undefined && top !== year.topperScore) {
    warnings.push(`The year says the topper scored ${year.topperScore} but the highest score in the file is ${top}.`);
  }
  return warnings;
}
