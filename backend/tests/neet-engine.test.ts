import { describe, expect, test } from "bun:test";
import type { NeetGroup } from "../src/generated/prisma/client";
import { consistencyWarnings, groupBands, parseDistributionCsv, summariseGroups } from "../src/modules/neet/distribution";
import { SCORE_MAX, SCORE_MIN, basisOf, buildGroupRows, buildRankResult, qualify, type Cutoff, type RankRowData } from "../src/modules/neet/rank-engine";
import { BAND_CSV, EXACT_CSV, EXACT_CUTOFFS } from "./neet-fixtures";

const at = (rows: RankRowData[], score: number) => rows.find((r) => r.score === score)!;
const exactBands = () => groupBands(parseDistributionCsv(EXACT_CSV));
const bandBands = () => groupBands(parseDistributionCsv(BAND_CSV));

describe("buildGroupRows: exact ties", () => {
  const rows = buildGroupRows(exactBands().get("OVERALL")!);

  test("one row for every integer score from 720 down to -180", () => {
    expect(rows.length).toBe(SCORE_MAX - SCORE_MIN + 1);
    expect(rows[0]!.score).toBe(720);
    expect(rows.at(-1)!.score).toBe(-180);
  });

  test("tied students share the range [students who scored more + 1, students who scored the same or more]", () => {
    expect(at(rows, 720)).toMatchObject({ rankFrom: 1, rankTo: 2, candidatesAtScore: 2, percentile: 100 });
    expect(at(rows, 700)).toMatchObject({ rankFrom: 3, rankTo: 5 });
    expect(at(rows, 650)).toMatchObject({ rankFrom: 6, rankTo: 15 });
    expect(at(rows, 600)).toMatchObject({ rankFrom: 16, rankTo: 45, candidatesAtScore: 30, percentile: 85 });
    expect(at(rows, 140)).toMatchObject({ rankFrom: 91, rankTo: 100, percentile: 10 });
  });

  test("exact rows have no uncertainty: the span equals the range", () => {
    for (const r of rows) expect([r.spanFrom, r.spanTo]).toEqual([r.rankFrom, r.rankTo]);
  });

  test("a score nobody got takes the single rank it would have had", () => {
    expect(at(rows, 610)).toMatchObject({ rankFrom: 16, rankTo: 16, candidatesAtScore: 0 });
    expect(at(rows, 720 - 1)).toMatchObject({ rankFrom: 3, rankTo: 3, candidatesAtScore: 0 });
    expect(at(rows, -180)).toMatchObject({ rankFrom: 101, rankTo: 101, candidatesAtScore: 0, percentile: 0 });
  });

  test("ranks never improve as the score falls (monotonic)", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.rankFrom).toBeGreaterThanOrEqual(rows[i - 1]!.rankFrom);
      expect(rows[i]!.percentile).toBeLessThanOrEqual(rows[i - 1]!.percentile);
      expect(rows[i]!.rankTo).toBeGreaterThanOrEqual(rows[i]!.rankFrom);
    }
  });

  test("input order does not matter", () => {
    const bands = exactBands().get("OVERALL")!;
    expect(buildGroupRows([...bands].reverse())).toEqual(rows);
  });

  test("a group with no candidates builds nothing", () => {
    expect(buildGroupRows([{ from: 500, to: 500, candidates: 0 }])).toEqual([]);
  });
});

describe("buildGroupRows: mark-range bands", () => {
  const rows = buildGroupRows(bandBands().get("OVERALL")!);

  test("a score inside a band is estimated by spreading the band evenly, and the span is the whole band", () => {
    // 600-699 holds ranks 11..110 (10 students scored above it). 650 sits 49 scores below the top.
    expect(at(rows, 650)).toMatchObject({ rankFrom: 60, rankTo: 60, spanFrom: 11, spanTo: 110, candidatesAtScore: 1 });
    expect(at(rows, 699)).toMatchObject({ rankFrom: 11, rankTo: 11, spanFrom: 11, spanTo: 110 });
    expect(at(rows, 600)).toMatchObject({ rankFrom: 110, rankTo: 110 });
  });

  test("every estimate stays inside its band's span, and ranks never improve as the score falls", () => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      expect(r.rankFrom).toBeGreaterThanOrEqual(r.spanFrom);
      expect(r.rankTo).toBeLessThanOrEqual(r.spanTo);
      expect(r.rankTo).toBeGreaterThanOrEqual(r.rankFrom);
      if (i > 0) expect(r.rankFrom).toBeGreaterThanOrEqual(rows[i - 1]!.rankFrom);
    }
  });

  test("a sparse band cannot push a score outside its own span", () => {
    // 10 students over 21 scores: the lowest score would round to zero students.
    expect(at(rows, 700)).toMatchObject({ rankFrom: 10, rankTo: 10, spanFrom: 1, spanTo: 10 });
  });

  test("the band below starts exactly after the band above", () => {
    expect(at(rows, 599)).toMatchObject({ spanFrom: 111, spanTo: 1000 });
  });

  test("basis: exact when every count is for a single score, banded as soon as one covers a range", () => {
    expect(basisOf(exactBands().values())).toBe("EXACT_TIES");
    expect(basisOf(bandBands().values())).toBe("BAND_INTERPOLATION");
  });
});

describe("determinism", () => {
  test("building twice gives byte-identical tables", () => {
    const a = JSON.stringify(buildGroupRows(exactBands().get("OVERALL")!));
    const b = JSON.stringify(buildGroupRows(exactBands().get("OVERALL")!));
    expect(a).toBe(b);
  });
});

describe("qualify", () => {
  const cutoffs = new Map<NeetGroup, Cutoff>(EXACT_CUTOFFS.map((c) => [c.group, { minScore: c.minScore, percentile: c.percentile }]));

  test("compares against the category cut-off, inclusive", () => {
    expect(qualify(300, "GENERAL", false, cutoffs)).toMatchObject({ qualified: true, cutoffScore: 300, appliedGroup: "GENERAL" });
    expect(qualify(299, "GENERAL", false, cutoffs)).toMatchObject({ qualified: false });
    expect(qualify(140, "OBC", false, cutoffs).qualified).toBe(true);
  });

  test("PwD uses the lower of the category and PwD cut-offs", () => {
    expect(qualify(250, "GENERAL", true, cutoffs)).toMatchObject({ qualified: true, cutoffScore: 200, appliedGroup: "PWD" });
    expect(qualify(250, "GENERAL", false, cutoffs).qualified).toBe(false);
    // OBC's own cut-off (140) is already lower than PwD's (200), so PwD changes nothing
    expect(qualify(150, "OBC", true, cutoffs)).toMatchObject({ qualified: true, cutoffScore: 140, appliedGroup: "OBC" });
  });

  test("unknown when the year has no cut-off for the category", () => {
    expect(qualify(500, "ST", false, new Map())).toEqual({ qualified: null, cutoffScore: null, cutoffPercentile: null, appliedGroup: null });
  });
});

describe("buildRankResult", () => {
  const tables = new Map([...exactBands()].map(([g, b]) => [g, buildGroupRows(b)]));
  const cutoffs = new Map<NeetGroup, Cutoff>(EXACT_CUTOFFS.map((c) => [c.group, { minScore: c.minScore, percentile: c.percentile }]));
  const year = { year: 2024, appeared: 100, basis: "EXACT_TIES" as const, cutoffs };
  const run = (score: number, category: "GENERAL" | "EWS" | "OBC" | "SC" | "ST", pwd = false) =>
    buildRankResult({ score, category, pwd }, year, { overall: at(tables.get("OVERALL")!, score), category: tables.get(category) && at(tables.get(category)!, score), pwd: tables.get("PWD") && at(tables.get("PWD")!, score) });

  test("a normal answer: ranges, percentile, counts and plain-words bullets", () => {
    const r = run(600, "GENERAL");
    expect(r).toMatchObject({
      outcome: "OK",
      allIndiaRank: { from: 16, to: 45 },
      categoryRank: { from: 8, to: 20 },
      percentile: 85,
      studentsAhead: 15,
      studentsAppeared: 100,
      studentsWithSameScore: 30,
      approximate: false,
      possibleRankSpan: null,
    });
    expect(r.explanation.join(" ")).toContain("30 students scored exactly 600");
    expect(r.explanation.join(" ")).toContain("Among General students, your rank is 8 to 20");
  });

  test("a score under the cut-off gets a typed BELOW_CUTOFF outcome and no rank", () => {
    const r = run(250, "GENERAL");
    expect(r.outcome).toBe("BELOW_CUTOFF");
    expect(r.qualification).toMatchObject({ qualified: false, cutoffScore: 300 });
    expect([r.allIndiaRank, r.categoryRank, r.pwdRank, r.percentile, r.studentsAhead]).toEqual([null, null, null, null, null]);
    expect(r.explanation.join(" ")).toContain("below it");
  });

  test("PwD turns the same score into a pass and adds the PwD rank", () => {
    const r = run(250, "GENERAL", true);
    expect(r.outcome).toBe("OK");
    expect(r.qualification.appliedGroup).toBe("PWD");
    expect(r.pwdRank).toEqual({ from: 3, to: 3 });
  });

  test("category rank is null (never guessed) when the year has no data for that category", () => {
    const r = run(500, "ST");
    expect(r.categoryRank).toBeNull();
    expect(r.explanation.join(" ")).toContain("Category-wise data is not available");
  });

  test("a single student is called exact, an empty score is explained", () => {
    expect(run(300, "OBC").explanation.join(" ")).toContain("20 students scored exactly 300");
    expect(run(610, "GENERAL").explanation.join(" ")).toContain("No student scored exactly 610");
  });

  test("approximate answers say so and expose the possible span", () => {
    const bandTables = new Map([...bandBands()].map(([g, b]) => [g, buildGroupRows(b)]));
    const r = buildRankResult(
      { score: 650, category: "GENERAL", pwd: false },
      { year: 2025, appeared: 1000, basis: "BAND_INTERPOLATION", cutoffs: new Map() },
      { overall: at(bandTables.get("OVERALL")!, 650), category: undefined, pwd: undefined },
    );
    expect(r).toMatchObject({ approximate: true, allIndiaRank: { from: 60, to: 60 }, possibleRankSpan: { from: 11, to: 110 }, studentsWithSameScore: null });
    expect(r.qualification.qualified).toBeNull();
    expect(r.explanation.join(" ")).toContain("approximate");
  });

  test("same input gives byte-identical output", () => {
    expect(JSON.stringify(run(600, "OBC"))).toBe(JSON.stringify(run(600, "OBC")));
  });
});

describe("parseDistributionCsv", () => {
  const msgs = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return ((e as { fields?: Array<{ message: string }> }).fields ?? []).map((f) => f.message);
    }
    throw new Error("expected a validation error");
  };
  const wrap = (body: string) => `group,score_from,score_to,candidates\n${body}`;

  test("accepts the fixture, blank score_to, comments, CRLF and a BOM", () => {
    expect(parseDistributionCsv(EXACT_CSV).length).toBe(21);
    const rows = parseDistributionCsv("﻿# from the NTA notice\r\nGroup, Score_From, Score_To, Candidates\r\noverall,600,,5\r\n");
    expect(rows).toEqual([{ group: "OVERALL", from: 600, to: 600, candidates: 5 }]);
  });

  test("ALL is accepted as another name for the All-India list (OVERALL)", () => {
    expect(parseDistributionCsv(wrap("ALL,600,600,5\nall,500,500,2\n"))).toEqual([
      { group: "OVERALL", from: 600, to: 600, candidates: 5 },
      { group: "OVERALL", from: 500, to: 500, candidates: 2 },
    ]);
  });

  test("rejects a wrong header, unknown group, bad numbers, thousands commas and out-of-range scores with line numbers", () => {
    expect(msgs(() => parseDistributionCsv("a,b,c\n"))[0]).toContain("first line must be exactly");
    const errs = msgs(() => parseDistributionCsv(wrap("OVERALL,600,600,5\nNOPE,1,1,1\nOVERALL,6x0,610,3\nOVERALL,500,500,1,200\nOVERALL,400,400,\"7\"\nOVERALL,800,800,1\nOVERALL,300,200,1\n")));
    expect(errs.find((m) => m.startsWith("Line 3"))).toContain('group "NOPE"');
    expect(errs.find((m) => m.startsWith("Line 4"))).toContain("whole numbers");
    expect(errs.find((m) => m.startsWith("Line 5"))).toContain("expected 4 values");
    expect(errs.find((m) => m.startsWith("Line 6"))).toContain("quotes");
    expect(errs.find((m) => m.startsWith("Line 7"))).toContain("between -180 and 720");
    expect(errs.find((m) => m.startsWith("Line 8"))).toContain("higher than score_to");
  });

  test("rejects overlapping ranges and duplicate scores inside a group, but allows the same score in different groups", () => {
    expect(msgs(() => parseDistributionCsv(wrap("OVERALL,600,610,5\nOVERALL,605,620,3\n")))[0]).toContain("overlap");
    expect(msgs(() => parseDistributionCsv(wrap("OVERALL,600,600,5\nOVERALL,600,600,3\n")))[0]).toContain("overlap");
    expect(parseDistributionCsv(wrap("OVERALL,600,600,5\nOBC,600,600,3\n")).length).toBe(2);
  });

  test("needs an OVERALL list, a data row and a non-empty file", () => {
    expect(msgs(() => parseDistributionCsv(wrap("OBC,600,600,3\n")))[0]).toContain("OVERALL");
    expect(msgs(() => parseDistributionCsv(wrap("")))[0]).toContain("no data rows");
    expect(msgs(() => parseDistributionCsv("")).join(" ")).toContain("empty");
  });
});

describe("consistency warnings", () => {
  test("a clean file has none; mismatches are reported, not fatal", () => {
    const groups = summariseGroups(exactBands());
    expect(consistencyWarnings(groups, { appeared: 100, topperScore: 720 })).toEqual([]);
    const w = consistencyWarnings(groups, { appeared: 120, topperScore: 700 });
    expect(w.join(" ")).toContain("adds up to 100 candidates but the year says 120");
    expect(w.join(" ")).toContain("topper scored 700");
  });
});
