import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { invalidate } from "../src/lib/cache";
import { prisma } from "../src/lib/prisma";
import { DISCLAIMER_DEFS } from "../src/modules/site/disclaimers";
import { cleanup, createStaff, loginAs } from "./admin-helpers";
import { call } from "./helpers";
import { BAND_CSV, BAND_CUTOFFS, EXACT_CSV, EXACT_CUTOFFS } from "./neet-fixtures";

const emails: string[] = [];

async function wipe() {
  await prisma.neetExamYear.deleteMany(); // counts, cut-offs and rank rows cascade
  await prisma.source.deleteMany();
  await invalidate("neet"); // rows were removed behind the cache's back
}
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await cleanup(emails);
});

async function as(role: "ADMIN" | "EDITOR" | "COUNSELLOR") {
  const u = await createStaff(role);
  emails.push(u.email);
  return loginAs(u.email);
}

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const newSource = (title = "NEET (UG) result notice") => prisma.source.create({ data: { kind: "NTA", title, publisher: "National Testing Agency", url: "https://exams.nta.ac.in/NEET/" } });
const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });
const body = (r: { body: unknown }) => r.body as any;

async function newYear(h: Record<string, string>, over: Record<string, unknown> = {}) {
  const source = await newSource();
  const res = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2024, appeared: 100, sourceId: source.id, checkedAt: iso(2), ...over } });
  expect(res.status).toBe(201);
  return { source, detail: body(res).examYear };
}
const upload = (h: Record<string, string>, year: number, csv: string, extra: Record<string, unknown> = {}) =>
  call(`/admin/neet/years/${year}/distribution`, { method: "PUT", headers: h, json: { csv, ...extra } });
const cutoffs = (h: Record<string, string>, year: number, list: readonly unknown[]) => call(`/admin/neet/years/${year}/cutoffs`, { method: "PUT", headers: h, json: { cutoffs: list } });
const publish = (h: Record<string, string>, year: number) => call(`/admin/neet/years/${year}/publish`, { method: "POST", headers: h });

/** A published 2024 year (exact counts) and optionally a published 2025 year (mark ranges). */
async function publishedYears(h: Record<string, string>, opts: { band?: boolean } = {}) {
  const { source } = await newYear(h);
  expect((await upload(h, 2024, EXACT_CSV)).status).toBe(200);
  expect((await cutoffs(h, 2024, EXACT_CUTOFFS)).status).toBe(200);
  expect((await publish(h, 2024)).status).toBe(200);
  if (opts.band) {
    const res = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2025, appeared: 1000, sourceId: source.id, checkedAt: iso(1), methodNote: "NTA gave counts per mark range." } });
    expect(res.status).toBe(201);
    expect((await upload(h, 2025, BAND_CSV)).status).toBe(200);
    expect((await cutoffs(h, 2025, BAND_CUTOFFS)).status).toBe(200);
    expect((await publish(h, 2025)).status).toBe(200);
  }
  return source;
}

describe("access control", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/admin/neet/years"],
    ["GET", "/admin/neet/years/2024"],
    ["GET", "/admin/neet/years/2024/preview?score=500&category=GENERAL"],
  ];

  test("anonymous callers get 401", async () => {
    for (const [method, path] of routes) expect((await call(path, { method })).status).toBe(401);
    expect((await call("/admin/neet/years/2024/publish", { method: "POST", headers: { "x-bp-admin": "1" } })).status).toBe(401);
  });

  test("COUNSELLOR is refused; EDITOR and ADMIN are allowed", async () => {
    const counsellor = await as("COUNSELLOR");
    const editor = await as("EDITOR");
    const admin = await as("ADMIN");
    expect((await call("/admin/neet/years", { headers: counsellor })).status).toBe(403);
    expect((await call("/admin/neet/years", { headers: editor })).status).toBe(200);
    expect((await call("/admin/neet/years", { headers: admin })).status).toBe(200);
  });

  test("a write without the X-BP-Admin header is refused", async () => {
    const h = await as("EDITOR");
    const { "x-bp-admin": _drop, ...noCsrf } = h;
    const source = await newSource();
    const res = await call("/admin/neet/years", { method: "POST", headers: noCsrf, json: { year: 2024, appeared: 100, sourceId: source.id, checkedAt: iso(1) } });
    expect(res.status).toBe(403);
    expect(await prisma.neetExamYear.count()).toBe(0);
  });
});

describe("nothing published yet", () => {
  test("the rank endpoint answers 404 and the data-sources table is empty", async () => {
    const rank = await call("/neet/rank?score=600&category=GENERAL");
    expect(rank.status).toBe(404);
    expect(body(rank).error.code).toBe("NOT_PUBLISHED_YET");
    // a year in the query does not change that: nothing is published, so it is not a "wrong year"
    const withYear = await call("/neet/rank?score=600&category=GENERAL&year=2026");
    expect(withYear.status).toBe(404);
    expect(body(withYear).error.code).toBe("NOT_PUBLISHED_YET");
    const sources = await call("/neet/data-sources");
    expect(sources.status).toBe(200);
    expect(body(sources).years).toEqual([]);
  });
});

describe("creating a year", () => {
  test("creates a DRAFT, audits it, and refuses duplicates, unknown sources and impossible numbers", async () => {
    const h = await as("EDITOR");
    const { source, detail } = await newYear(h, { qualified: 90, topperScore: 720, resultDate: "2024-06-04", methodNote: "  Every score published.  " });
    expect(detail).toMatchObject({ year: 2024, status: "DRAFT", appeared: 100, qualified: 90, resultDate: "2024-06-04", methodNote: "Every score published.", basis: null, distribution: null, tableVersion: null });
    expect(detail.publishProblems.length).toBe(2);
    expect(await auditCount("neet_year.create")).toBe(1);

    const dup = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2024, appeared: 5, sourceId: source.id, checkedAt: iso(1) } });
    expect(dup.status).toBe(422);
    expect(body(dup).error.fields[0].path).toBe("year");

    const unknown = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2023, appeared: 5, sourceId: "0197a1b2-0000-7000-8000-000000000000", checkedAt: iso(1) } });
    expect(body(unknown).error.fields[0].path).toBe("sourceId");

    const impossible = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2023, appeared: 5, qualified: 6, sourceId: source.id, checkedAt: iso(1) } });
    expect(body(impossible).error.fields[0].path).toBe("qualified");

    const future = await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2023, appeared: 5, sourceId: source.id, checkedAt: new Date(Date.now() + 10 * 86_400_000).toISOString() } });
    expect(body(future).error.fields[0].path).toBe("checkedAt");
  });
});

describe("score-count upload", () => {
  test("a dry run reports but saves nothing; a real upload builds the rank table and replaces it on re-upload", async () => {
    const h = await as("EDITOR");
    await newYear(h);

    const dry = await upload(h, 2024, EXACT_CSV, { dryRun: true });
    expect(dry.status).toBe(200);
    expect(body(dry).report).toMatchObject({ dryRun: true, basis: "EXACT_TIES", warnings: [], rankRowsBuilt: 6 * 901 });
    expect(await prisma.neetRankRow.count()).toBe(0);
    expect(await prisma.neetScoreDistribution.count()).toBe(0);

    const real = await upload(h, 2024, EXACT_CSV, { fileName: "neet-2024-counts.csv" });
    const report = body(real).report;
    expect(report.dryRun).toBe(false);
    expect(report.groups.find((g: any) => g.group === "OVERALL")).toMatchObject({ rows: 7, candidates: 100, highestScore: 720, lowestScore: 140 });
    expect(await prisma.neetRankRow.count()).toBe(6 * 901);
    expect(await prisma.neetScoreDistribution.count()).toBe(21);

    const detail = body(await call("/admin/neet/years/2024", { headers: h })).examYear;
    expect(detail.basis).toBe("EXACT_TIES");
    expect(detail.distribution).toMatchObject({ fileName: "neet-2024-counts.csv" });
    expect(detail.distribution.sha256).toHaveLength(64);
    expect(detail.tableVersion).toBe(report.tableVersion);

    // Re-uploading the same file changes nothing (same table version, no duplicate rows)
    const again = await upload(h, 2024, EXACT_CSV);
    expect(body(again).report.tableVersion).toBe(report.tableVersion);
    expect(await prisma.neetRankRow.count()).toBe(6 * 901);

    // A different file replaces the data and gives a different version
    const banded = await upload(h, 2024, BAND_CSV);
    expect(body(banded).report).toMatchObject({ basis: "BAND_INTERPOLATION", rankRowsBuilt: 901 });
    expect(body(banded).report.tableVersion).not.toBe(report.tableVersion);
    expect(await prisma.neetRankRow.count()).toBe(901);
    expect(await auditCount("neet_year.upload_distribution")).toBe(3);
  });

  test("a bad file is refused with line numbers and leaves the saved data untouched", async () => {
    const h = await as("EDITOR");
    await newYear(h);
    await upload(h, 2024, EXACT_CSV);
    const res = await upload(h, 2024, "group,score_from,score_to,candidates\nOVERALL,600,600,5\nOVERALL,700,700,1,000\n");
    expect(res.status).toBe(422);
    expect(body(res).error.fields[0].message).toContain("Line 3");
    expect(await prisma.neetScoreDistribution.count()).toBe(21);
  });

  test("cross-checks show up as warnings on the year, never as errors", async () => {
    const h = await as("EDITOR");
    await newYear(h, { appeared: 120, topperScore: 700 });
    const res = await upload(h, 2024, EXACT_CSV);
    expect(res.status).toBe(200);
    expect(body(res).report.warnings.join(" ")).toContain("year says 120");
    const detail = body(await call("/admin/neet/years/2024", { headers: h })).examYear;
    expect(detail.warnings.length).toBe(2);
  });

  test("upload to an unknown year is a 404", async () => {
    const h = await as("EDITOR");
    expect((await upload(h, 2019, EXACT_CSV)).status).toBe(404);
  });
});

describe("cut-offs and publishing", () => {
  test("publishing is blocked until counts and every required cut-off exist, and the 422 says what is missing", async () => {
    const h = await as("EDITOR");
    await newYear(h);
    let res = await publish(h, 2024);
    expect(res.status).toBe(422);
    expect(body(res).error.fields.map((f: any) => f.message).join(" ")).toContain("Upload the score-count file");

    await upload(h, 2024, EXACT_CSV);
    await cutoffs(h, 2024, EXACT_CUTOFFS.filter((c) => c.group !== "ST" && c.group !== "PWD"));
    res = await publish(h, 2024);
    expect(res.status).toBe(422);
    expect(body(res).error.fields[0].message).toBe("Add the qualifying cut-off for: ST.");
    expect((await prisma.neetExamYear.findUniqueOrThrow({ where: { year: 2024 } })).status).toBe("DRAFT");

    await cutoffs(h, 2024, EXACT_CUTOFFS);
    res = await publish(h, 2024);
    expect(res.status).toBe(200);
    expect(body(res).examYear).toMatchObject({ status: "PUBLISHED", publishProblems: [] });
    expect(await auditCount("neet_year.publish")).toBe(1);
    expect((await publish(h, 2024)).status).toBe(409);
  });

  test("cut-offs: a group listed twice or an unknown group is refused; the list is a full replacement", async () => {
    const h = await as("EDITOR");
    await newYear(h);
    const dup = await cutoffs(h, 2024, [EXACT_CUTOFFS[0], EXACT_CUTOFFS[0]]);
    expect(dup.status).toBe(422);
    const bad = await cutoffs(h, 2024, [{ group: "OVERALL", percentile: 50, minScore: 100 }]);
    expect(bad.status).toBe(422);
    await cutoffs(h, 2024, EXACT_CUTOFFS);
    const res = await cutoffs(h, 2024, EXACT_CUTOFFS.slice(0, 2));
    expect(body(res).examYear.cutoffs.map((c: any) => c.group)).toEqual(["GENERAL", "EWS"]);
  });

  test("a published year is locked: data, cut-offs, key figures and deletion are refused; checkedAt and methodNote can still change", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    expect((await upload(h, 2024, EXACT_CSV)).status).toBe(409);
    expect((await cutoffs(h, 2024, EXACT_CUTOFFS)).status).toBe(409);
    expect((await call("/admin/neet/years/2024", { method: "PATCH", headers: h, json: { appeared: 5 } })).status).toBe(409);
    expect((await call("/admin/neet/years/2024", { method: "DELETE", headers: h })).status).toBe(409);

    const patch = await call("/admin/neet/years/2024", { method: "PATCH", headers: h, json: { checkedAt: iso(0), methodNote: "Re-checked." } });
    expect(patch.status).toBe(200);
    expect(body(patch).examYear.methodNote).toBe("Re-checked.");
    // ...and the public table shows it straight away
    expect(body(await call("/neet/data-sources")).years[0].methodNote).toBe("Re-checked.");
  });

  test("unpublish makes the year editable and removes it from the public API; delete then cascades", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    expect((await call("/neet/rank?score=600&category=GENERAL")).status).toBe(200);

    const un = await call("/admin/neet/years/2024/unpublish", { method: "POST", headers: h });
    expect(body(un).examYear.status).toBe("DRAFT");
    expect((await call("/neet/rank?score=600&category=GENERAL")).status).toBe(404);
    expect((await call("/admin/neet/years/2024/unpublish", { method: "POST", headers: h })).status).toBe(409);

    expect((await call("/admin/neet/years/2024", { method: "DELETE", headers: h })).status).toBe(200);
    expect(await prisma.neetRankRow.count()).toBe(0);
    expect(await prisma.neetScoreDistribution.count()).toBe(0);
    expect(await prisma.neetQualifyingCutoff.count()).toBe(0);
    expect(await auditCount("neet_year.delete")).toBe(1);
  });

  test("a source that a NEET year cites cannot be deleted (409)", async () => {
    const h = await as("EDITOR");
    const source = await publishedYears(h);
    const res = await call(`/admin/sources/${source.id}`, { method: "DELETE", headers: h });
    expect(res.status).toBe(409);
    expect(await prisma.source.count()).toBe(1);
  });
});

describe("preview", () => {
  test("staff can check a draft year before publishing; the public API still cannot see it", async () => {
    const h = await as("EDITOR");
    await newYear(h);
    expect((await call("/admin/neet/years/2024/preview?score=600&category=GENERAL", { headers: h })).status).toBe(409); // no data yet
    await upload(h, 2024, EXACT_CSV);
    await cutoffs(h, 2024, EXACT_CUTOFFS);
    const res = await call("/admin/neet/years/2024/preview?score=600&category=GENERAL", { headers: h });
    expect(res.status).toBe(200);
    expect(body(res).result.allIndiaRank).toEqual({ from: 16, to: 45 });
    expect((await call("/neet/rank?score=600&category=GENERAL")).status).toBe(404);
  });
});

describe("GET /neet/rank", () => {
  test("a known score gives the hand-calculated range, percentile, category rank, sources and disclaimer", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const res = await call("/neet/rank?score=600&category=GENERAL");
    expect(res.status).toBe(200);
    const { result, otherYears, meta } = body(res);
    expect(result).toMatchObject({
      year: 2024,
      outcome: "OK",
      score: 600,
      category: "GENERAL",
      pwd: false,
      allIndiaRank: { from: 16, to: 45 },
      categoryRank: { from: 8, to: 20 },
      pwdRank: null,
      percentile: 85,
      studentsAhead: 15,
      studentsAppeared: 100,
      studentsWithSameScore: 30,
      approximate: false,
      basis: "EXACT_TIES",
      qualification: { qualified: true, cutoffScore: 300, appliedGroup: "GENERAL" },
      source: { title: "NEET (UG) result notice", publisher: "National Testing Agency" },
    });
    expect(result.tableVersion).toMatch(/^2024-[0-9a-f]{12}$/);
    expect(result.explanation.length).toBeGreaterThanOrEqual(4);
    expect(otherYears).toEqual([]);
    expect(meta.disclaimer).toEqual({ key: "NOT_GUARANTEED", version: 0, text: DISCLAIMER_DEFS.find((d) => d.key === "NOT_GUARANTEED")!.text });
  });

  test("same score and same data always give an identical answer (determinism)", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const a = await call("/neet/rank?score=500&category=OBC");
    await invalidate("neet"); // force a recompute instead of a cache hit
    const b = await call("/neet/rank?score=500&category=OBC");
    expect(a.text).toBe(b.text);
  });

  test("below the cut-off: typed outcome, no rank; PwD lowers the cut-off and adds the PwD rank", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const below = body(await call("/neet/rank?score=250&category=GENERAL")).result;
    expect(below).toMatchObject({ outcome: "BELOW_CUTOFF", allIndiaRank: null, categoryRank: null, percentile: null, qualification: { qualified: false, cutoffScore: 300 } });

    const pwd = body(await call("/neet/rank?score=250&category=GENERAL&pwd=true")).result;
    expect(pwd).toMatchObject({ outcome: "OK", allIndiaRank: { from: 91, to: 91 }, categoryRank: { from: 41, to: 41 }, percentile: 10, pwdRank: { from: 3, to: 3 }, qualification: { appliedGroup: "PWD", cutoffScore: 200 } });
  });

  test("category rank is null when the year has no data for that category", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const r = body(await call("/neet/rank?score=500&category=ST")).result;
    expect(r.categoryRank).toBeNull();
    expect(r.allIndiaRank).toEqual({ from: 46, to: 70 });
  });

  test("with two published years: newest by default, the other listed, band years flagged approximate", async () => {
    const h = await as("EDITOR");
    await publishedYears(h, { band: true });
    const res = body(await call("/neet/rank?score=650&category=GENERAL"));
    expect(res.result).toMatchObject({ year: 2025, approximate: true, basis: "BAND_INTERPOLATION", allIndiaRank: { from: 60, to: 60 }, possibleRankSpan: { from: 11, to: 110 }, studentsWithSameScore: null });
    expect(res.result.explanation.join(" ")).toContain("approximate");
    expect(res.otherYears).toEqual([{ year: 2024, outcome: "OK", allIndiaRank: { from: 6, to: 15 }, approximate: false, basis: "EXACT_TIES" }]);

    const older = body(await call("/neet/rank?score=650&category=GENERAL&year=2024"));
    expect(older.result.year).toBe(2024);
    expect(older.otherYears[0]).toMatchObject({ year: 2025, approximate: true, allIndiaRank: { from: 60, to: 60 } });
  });

  test("an unavailable year, an out-of-range score and missing inputs are field errors, not 500s", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const year = await call("/neet/rank?score=600&category=GENERAL&year=2019");
    expect(year.status).toBe(422);
    expect(body(year).error.fields[0]).toMatchObject({ path: "year" });
    expect(body(year).error.fields[0].message).toContain("Available years: 2024");

    for (const q of ["score=721&category=GENERAL", "score=-181&category=GENERAL", "score=600.5&category=GENERAL", "score=abc&category=GENERAL", "category=GENERAL", "score=600", "score=600&category=OPEN"]) {
      const res = await call(`/neet/rank?${q}`);
      expect(res.status).toBe(422);
      expect(body(res).error.code).toBe("VALIDATION_FAILED");
    }
    // every refusal names the field and says what is allowed (no "(body)", no "Expected union value")
    const fieldError = async (q: string) => {
      const res = await call(`/neet/rank?${q}`);
      expect(res.status).toBe(422);
      expect(body(res).error.fields).toHaveLength(1);
      return body(res).error.fields[0] as { path: string; message: string };
    };
    expect(await fieldError("score=721&category=GENERAL")).toEqual({ path: "score", message: "Enter a whole number from -180 to 720." });
    expect(await fieldError("score=-181&category=GENERAL")).toEqual({ path: "score", message: "Enter a whole number from -180 to 720." });
    expect(await fieldError("score=abc&category=GENERAL")).toEqual({ path: "score", message: "Enter a whole number from -180 to 720." });
    expect(await fieldError("category=GENERAL")).toEqual({ path: "score", message: "This is required." });
    expect(await fieldError("score=600&category=OPEN")).toEqual({ path: "category", message: "Enter one of GENERAL, EWS, OBC, SC or ST." });
    expect(await fieldError("score=600&category=GENERAL&pwd=maybe")).toEqual({ path: "pwd", message: "Enter true or false." });
    expect(await fieldError("score=600&category=GENERAL&year=1999")).toEqual({ path: "year", message: "Enter a whole number from 2013 to 2100." });
    // the extremes are valid
    expect((await call("/neet/rank?score=720&category=GENERAL")).status).toBe(200);
    expect((await call("/neet/rank?score=-180&category=GENERAL")).status).toBe(200);
    // a blank optional param means "not provided" (D-045)
    expect((await call("/neet/rank?score=600&category=GENERAL&year=&pwd=")).status).toBe(200);
  });

  test("responses carry an ETag and a repeat request with it gets 304", async () => {
    const h = await as("EDITOR");
    await publishedYears(h);
    const first = await call("/neet/rank?score=600&category=GENERAL");
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("max-age=60");
    const second = await call("/neet/rank?score=600&category=GENERAL", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });

  test("publishing a newer year is visible immediately (cache invalidated)", async () => {
    const h = await as("EDITOR");
    const source = await publishedYears(h);
    expect(body(await call("/neet/rank?score=650&category=GENERAL")).result.year).toBe(2024);
    await call("/admin/neet/years", { method: "POST", headers: h, json: { year: 2025, appeared: 1000, sourceId: source.id, checkedAt: iso(1) } });
    await upload(h, 2025, BAND_CSV);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    await publish(h, 2025);
    expect(body(await call("/neet/rank?score=650&category=GENERAL")).result.year).toBe(2025);
  });
});

describe("GET /neet/data-sources", () => {
  test("lists published years newest first with source, basis, groups and cut-offs", async () => {
    const h = await as("EDITOR");
    await publishedYears(h, { band: true });
    await newYear(h, { year: 2023 }); // a draft stays hidden
    const res = await call("/neet/data-sources");
    expect(res.status).toBe(200);
    const { years, meta } = body(res);
    expect(years.map((y: any) => y.year)).toEqual([2025, 2024]);
    expect(years[0]).toMatchObject({ basis: "BAND_INTERPOLATION", approximate: true, appeared: 1000, methodNote: "NTA gave counts per mark range.", groups: ["OVERALL"], source: { publisher: "National Testing Agency" } });
    expect(years[1]).toMatchObject({ basis: "EXACT_TIES", approximate: false, groups: ["OVERALL", "GENERAL", "EWS", "OBC", "SC", "PWD"] });
    expect(years[1].cutoffs).toHaveLength(6);
    expect(meta.disclaimer.text).toContain("do not guarantee");
    expect(res.headers.get("etag")).toBeTruthy();
  });
});

describe("a year where NTA published no score counts (totals and cut-offs only)", () => {
  async function noDataYear(h: Record<string, string>, source: { id: string }, year = 2025) {
    const res = await call("/admin/neet/years", { method: "POST", headers: h, json: { year, appeared: 1000, qualified: 600, rankData: false, sourceId: source.id, checkedAt: iso(1), methodNote: "NTA gave totals only." } });
    expect(res.status).toBe(201);
    expect(body(res).examYear).toMatchObject({ rankData: false, basis: null, tableVersion: null });
    return res;
  }

  test("is published without an upload, but still needs the cut-offs; an upload is refused", async () => {
    const h = await as("EDITOR");
    const source = await newSource();
    await noDataYear(h, source);
    expect(body(await call("/admin/neet/years/2025", { headers: h })).examYear.publishProblems).toEqual(["Add the qualifying cut-off for: GENERAL, EWS, OBC, SC, ST."]);
    expect((await upload(h, 2025, EXACT_CSV)).status).toBe(409);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    const res = await publish(h, 2025);
    expect(res.status).toBe(200);
    expect(body(res).examYear).toMatchObject({ status: "PUBLISHED", rankData: false, publishProblems: [] });
  });

  test("rankData cannot be switched off once counts are uploaded", async () => {
    const h = await as("EDITOR");
    await newYear(h);
    await upload(h, 2024, EXACT_CSV);
    const res = await call("/admin/neet/years/2024", { method: "PATCH", headers: h, json: { rankData: false } });
    expect(res.status).toBe(422);
    expect(body(res).error.fields[0].path).toBe("rankData");
  });

  test("asking for that year gives a typed NOT_PUBLISHED_BY_NTA answer, still saying whether the score qualifies", async () => {
    const h = await as("EDITOR");
    const source = await publishedYears(h);
    await noDataYear(h, source);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    await publish(h, 2025);

    const res = await call("/neet/rank?score=600&category=GENERAL&year=2025");
    expect(res.status).toBe(200);
    const { result, otherYears } = body(res);
    expect(result).toMatchObject({
      year: 2025,
      outcome: "NOT_PUBLISHED_BY_NTA",
      allIndiaRank: null,
      categoryRank: null,
      percentile: null,
      basis: null,
      tableVersion: null,
      approximate: false,
      studentsAppeared: 1000,
      qualification: { qualified: true, cutoffScore: 120 },
    });
    expect(result.explanation[0]).toContain("did not publish how many students got each score");
    expect(otherYears).toEqual([{ year: 2024, outcome: "OK", allIndiaRank: { from: 16, to: 45 }, approximate: false, basis: "EXACT_TIES" }]);

    const under = body(await call("/neet/rank?score=50&category=GENERAL&year=2025")).result;
    expect(under).toMatchObject({ outcome: "NOT_PUBLISHED_BY_NTA", qualification: { qualified: false } });
  });

  test("the default year is the newest one that has rank data, and the other-years list shows the no-data year", async () => {
    const h = await as("EDITOR");
    const source = await publishedYears(h); // 2024 with data
    await noDataYear(h, source, 2025);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    await publish(h, 2025);
    const res = body(await call("/neet/rank?score=600&category=GENERAL"));
    expect(res.result).toMatchObject({ year: 2024, outcome: "OK" });
    expect(res.otherYears).toEqual([{ year: 2025, outcome: "NOT_PUBLISHED_BY_NTA", allIndiaRank: null, approximate: false, basis: null }]);
  });

  test("data-sources lists it with rankData false and no groups", async () => {
    const h = await as("EDITOR");
    const source = await publishedYears(h);
    await noDataYear(h, source);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    await publish(h, 2025);
    const years = body(await call("/neet/data-sources")).years;
    expect(years.map((y: any) => y.year)).toEqual([2025, 2024]);
    expect(years[0]).toMatchObject({ rankData: false, basis: null, approximate: false, groups: [], tableVersion: null, methodNote: "NTA gave totals only." });
    expect(years[1]).toMatchObject({ rankData: true, basis: "EXACT_TIES" });
  });

  test("preview works for a no-data draft", async () => {
    const h = await as("EDITOR");
    const source = await newSource();
    await noDataYear(h, source);
    await cutoffs(h, 2025, BAND_CUTOFFS);
    const res = await call("/admin/neet/years/2025/preview?score=600&category=GENERAL", { headers: h });
    expect(res.status).toBe(200);
    expect(body(res).result.outcome).toBe("NOT_PUBLISHED_BY_NTA");
  });
});
