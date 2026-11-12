import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { slugify, slugifyShort } from "../src/lib/slug";
import { commitCollegeImport, parseCollegeWorkbook, planCollegeImport, type ImportRow } from "../src/modules/college/college-import";
import { seedReferenceData } from "../prisma/seed/reference";
import { cleanup, createStaff } from "./admin-helpers";

const emails: string[] = [];

/** Prisma queries are lazy; run one inside a real promise and expect the database to refuse it. */
const fails = (query: PromiseLike<unknown>) => expect((async () => void (await query))()).rejects.toThrow();

async function wipe() {
  await prisma.nmcNotice.deleteMany();
  await prisma.college.deleteMany(); // cascades profiles, fee lines, source links, FAQs
  await prisma.importBatch.deleteMany();
  await prisma.fxRate.deleteMany();
  await prisma.country.deleteMany();
  await prisma.state.deleteMany();
  await prisma.source.deleteMany();
}
beforeEach(async () => {
  await wipe();
  await seedReferenceData();
});
afterAll(async () => {
  await wipe();
  await cleanup(emails);
});

async function actor() {
  const u = await createStaff("ADMIN");
  emails.push(u.email);
  return { id: u.user.id, email: u.email };
}

async function workbook(rows: unknown[][], opts: { sheet?: string; header?: string[]; titleRows?: number } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheet ?? "All colleges");
  for (let i = 0; i < (opts.titleRows ?? 0); i++) ws.addRow([`title line ${i}`]);
  ws.addRow(opts.header ?? ["Country", "#", "College", "City", "Verified", "Note"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  line: 2, country: "Russia", name: "Altai State Medical University", city: "Barnaul", verified: "Well-known location", note: null, ...over,
});

describe("slug helpers", () => {
  test("slugify removes accents, symbols and edge hyphens", () => {
    expect(slugify("Curaçao & Co. (Medical)")).toBe("curacao-and-co-medical");
    expect(slugify("  --Hello  World-- ")).toBe("hello-world");
  });
  test("slugifyShort cuts long names at a hyphen", () => {
    const s = slugifyShort("International School of Medicine, International University of Kyrgyzstan and a Very Long Extra Tail", 60);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
    expect(s.startsWith("international-school-of-medicine")).toBe(true);
  });
});

describe("parseCollegeWorkbook", () => {
  test("reads the college sheet, finds columns by header name in any order, skips blank lines", async () => {
    const buf = await workbook(
      [["Barnaul", "Altai State Medical University", "Russia", "Checked online", "Some note"], [], [null, null, null]],
      { header: ["City", "College", "Country", "Verified", "Note"], titleRows: 2 },
    );
    const r = await parseCollegeWorkbook(buf);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ line: 4, country: "Russia", name: "Altai State Medical University", city: "Barnaul", verified: "Checked online", note: "Some note" }]);
  });

  test("a row with no college name is reported with its row number and the others are still read", async () => {
    const buf = await workbook([["Russia", 1, "", "Ufa"], ["Russia", 2, "Bashkir State Medical University", "Ufa"]]);
    const r = await parseCollegeWorkbook(buf);
    expect(r.errors).toEqual([{ line: 2, message: "College name is empty." }]);
    expect(r.rows.map((x) => x.name)).toEqual(["Bashkir State Medical University"]);
  });

  test("tells the user which sheets exist when the college sheet is missing, and when headers are missing", async () => {
    await expect(parseCollegeWorkbook(await workbook([], { sheet: "Random" }))).rejects.toThrow(/Could not find a sheet.*"Random"/);
    await expect(parseCollegeWorkbook(await workbook([], { header: ["Foo", "Bar"] }))).rejects.toThrow(/needs a header row/);
  });
});

describe("planCollegeImport", () => {
  test("plain rows become CREATE with a readable slug, grouped per country", async () => {
    const plan = await planCollegeImport([row(), row({ line: 3, country: "Georgia", name: "Alte University", city: "Tbilisi" })]);
    expect(plan.counts).toMatchObject({ CREATE: 2, ERROR: 0 });
    expect(plan.items.map((i) => i.slug)).toEqual(["altai-state-medical-university", "alte-university"]);
    expect(plan.perCountry).toEqual({ Russia: 1, Georgia: 1 });
  });

  test("problems are explained per row and do not stop the other rows", async () => {
    const plan = await planCollegeImport([
      row({ line: 2, country: "Atlantis" }),
      row({ line: 3, city: "" }),
      row({ line: 4, verified: "Trust me" }),
      row({ line: 5, country: "" }),
      row({ line: 6, name: "!!!" }),
      row({ line: 7, name: "A".repeat(201) }),
      row({ line: 8 }),
    ]);
    const byLine = Object.fromEntries(plan.items.map((i) => [i.line, i]));
    expect(byLine[2]!.message).toContain('Country "Atlantis" is not in the countries list');
    expect(byLine[3]!.message).toBe("City is empty.");
    expect(byLine[4]!.message).toContain('"Trust me" is not a known value for Verified');
    expect(byLine[5]!.message).toBe("Country is empty.");
    expect(byLine[6]!.message).toContain("no letters or digits");
    expect(byLine[7]!.message).toContain("longer than 200");
    expect(byLine[8]!.action).toBe("CREATE");
    expect(plan.counts).toMatchObject({ ERROR: 6, CREATE: 1 });
  });

  test("country names are matched ignoring case and via aliases", async () => {
    const plan = await planCollegeImport([row({ country: "russia" }), row({ line: 3, name: "X", country: "Kyrgyz" }), row({ line: 4, name: "Y", country: "Curaçao" })]);
    expect(plan.counts).toMatchObject({ CREATE: 3, ERROR: 0 });
  });

  test("the same college twice in one file is an error for the second row", async () => {
    const plan = await planCollegeImport([row(), row({ line: 3, name: "ALTAI STATE MEDICAL UNIVERSITY" })]);
    expect(plan.items[1]).toMatchObject({ action: "ERROR" });
    expect(plan.items[1]!.message).toContain("appears twice for Russia");
  });

  test("two different colleges with the same name in different countries get different slugs", async () => {
    const plan = await planCollegeImport([
      row({ name: "International Medical School" }),
      row({ line: 3, name: "International Medical School", country: "Kazakhstan", city: "Almaty" }),
    ]);
    expect(plan.items.map((i) => i.slug)).toEqual(["international-medical-school", "international-medical-school-kazakhstan"]);
  });
});

describe("commitCollegeImport", () => {
  test("creates abroad drafts with an empty profile, records the batch and audit entry, and makes nothing public", async () => {
    const who = await actor();
    const plan = await planCollegeImport([row({ note: "Check the city" }), row({ line: 3, name: "Alte University", country: "Georgia", city: "Tbilisi", verified: "Checked online" })]);
    const res = await commitCollegeImport(plan, { filename: "list.xlsx", sha256: "abc", actor: who });
    expect(res).toMatchObject({ created: 2, updated: 0 });

    const colleges = await prisma.college.findMany({ include: { abroadProfile: true, country: true }, orderBy: { name: "asc" } });
    expect(colleges).toHaveLength(2);
    for (const c of colleges) {
      expect(c).toMatchObject({ kind: "ABROAD", status: "DRAFT", readyAt: null, stateId: null, totalCourseFeeInr: null, importBatchId: res.batchId });
      expect(c.abroadProfile).toMatchObject({ wdomsListed: "UNKNOWN", intakeMonths: [] });
    }
    expect(colleges[0]).toMatchObject({ name: "Altai State Medical University", locationBasis: "WELL_KNOWN", internalNotes: "Check the city" });
    expect(colleges[1]).toMatchObject({ name: "Alte University", locationBasis: "CHECKED_ONLINE", city: "Tbilisi" });
    expect(colleges[1]!.country!.name).toBe("Georgia");

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: res.batchId! } });
    expect(batch).toMatchObject({ kind: "COLLEGES", status: "COMMITTED", filename: "list.xlsx", fileSha256: "abc", createdById: who.id });
    expect(batch.committedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "college_import.commit", entityId: res.batchId! } })).toBe(1);
  });

  test("re-running the same list changes nothing", async () => {
    const who = await actor();
    const rows = [row(), row({ line: 3, name: "Alte University", country: "Georgia", city: "Tbilisi" })];
    await commitCollegeImport(await planCollegeImport(rows), { filename: "a.xlsx", sha256: "1", actor: who });
    const again = await planCollegeImport(rows);
    expect(again.counts).toMatchObject({ CREATE: 0, UNCHANGED: 2, ERROR: 0 });
    const res = await commitCollegeImport(again, { filename: "a.xlsx", sha256: "1", actor: who });
    expect(res).toEqual({ batchId: null, created: 0, updated: 0 });
    expect(await prisma.college.count()).toBe(2);
    expect(await prisma.importBatch.count()).toBe(1); // a no-op re-run records no batch
  });

  test("staff edits survive: an existing college keeps its city and note, only empty fields are filled", async () => {
    const who = await actor();
    await commitCollegeImport(await planCollegeImport([row({ verified: null })]), { filename: "a.xlsx", sha256: "1", actor: who });
    await prisma.college.updateMany({ data: { city: "Edited City" } });

    const plan = await planCollegeImport([row({ city: "Barnaul", verified: "Checked online", note: "From the list" })]);
    expect(plan.items[0]).toMatchObject({ action: "UPDATE" });
    expect(plan.items[0]!.message).toContain("city check and note");
    await commitCollegeImport(plan, { filename: "b.xlsx", sha256: "2", actor: who });
    expect(await prisma.college.findFirstOrThrow()).toMatchObject({ city: "Edited City", locationBasis: "CHECKED_ONLINE", internalNotes: "From the list" });

    await prisma.college.updateMany({ data: { internalNotes: "Staff wrote this" } });
    const third = await planCollegeImport([row({ note: "From the list again", verified: "Checked online" })]);
    expect(third.items[0]).toMatchObject({ action: "UNCHANGED" });
  });

  test("a college that is already ready or archived is skipped and reported", async () => {
    const who = await actor();
    await commitCollegeImport(await planCollegeImport([row()]), { filename: "a.xlsx", sha256: "1", actor: who });
    await prisma.college.updateMany({ data: { status: "ARCHIVED" } });
    const plan = await planCollegeImport([row({ note: "x", verified: "Checked online" })]);
    expect(plan.items[0]).toMatchObject({ action: "UPDATE" }); // empty fields can still be filled on an archived row
    await prisma.college.updateMany({ data: { locationBasis: "WELL_KNOWN", internalNotes: "n" } });
    const skip = await planCollegeImport([row()]);
    expect(skip.items[0]).toMatchObject({ action: "SKIP" });
    expect(skip.items[0]!.message).toContain("Already archived");
  });

  test("rows with errors are never written", async () => {
    const who = await actor();
    const plan = await planCollegeImport([row(), row({ line: 3, name: "Nowhere University", country: "Atlantis" })]);
    const res = await commitCollegeImport(plan, { filename: "a.xlsx", sha256: "1", actor: who });
    expect(res.created).toBe(1);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: res.batchId! } });
    expect(batch.errors).toEqual([{ line: 3, name: "Nowhere University", message: expect.stringContaining("Atlantis") }]);
  });
});

describe("database safety nets", () => {
  async function anyCountry() {
    return prisma.country.findFirstOrThrow({ where: { slug: "russia" } });
  }
  const base = { slug: "c1", name: "C1", city: "X" };

  test("an India college cannot have a country, an abroad college cannot have a state", async () => {
    const c = await anyCountry();
    const s = await prisma.state.findFirstOrThrow();
    await fails(prisma.college.create({ data: { ...base, kind: "INDIA", countryId: c.id } }));
    await fails(prisma.college.create({ data: { ...base, kind: "ABROAD", stateId: s.id } }));
    // Both are fine while empty (a draft) or correctly filled in.
    await prisma.college.create({ data: { ...base, kind: "INDIA", stateId: s.id } });
    await prisma.college.create({ data: { slug: "c2", name: "C2", city: "Y", kind: "ABROAD", countryId: c.id } });
    await prisma.college.create({ data: { slug: "c3", name: "C3", city: "Y", kind: "ABROAD" } });
  });

  test("only a ready college has a ready date", async () => {
    await fails(prisma.college.create({ data: { ...base, kind: "ABROAD", status: "READY" } }));
    await fails(prisma.college.create({ data: { ...base, kind: "ABROAD", status: "DRAFT", readyAt: new Date() } }));
    await prisma.college.create({ data: { ...base, kind: "ABROAD", status: "READY", readyAt: new Date() } });
  });

  test("fee lines: one per year, sane year, non-negative amounts, upper-case 3-letter currency", async () => {
    const col = await prisma.college.create({ data: { ...base, kind: "ABROAD" } });
    const line = { collegeId: col.id, tuition: 4500, currency: "USD" };
    await prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 1 } });
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 1 } })); // duplicate year
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 0 } }));
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 13 } }));
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 2, tuition: -1 } }));
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 2, currency: "usd" } }));
    await fails(prisma.collegeFeeLine.create({ data: { ...line, yearNumber: 2, currency: "US" } }));
  });

  test("exchange rates: positive, upper-case, and INR is never stored", async () => {
    const ok = { rateToInr: 88.5, asOf: new Date("2026-11-12") };
    await prisma.fxRate.create({ data: { currency: "USD", ...ok } });
    await fails(prisma.fxRate.create({ data: { currency: "INR", ...ok } }));
    await fails(prisma.fxRate.create({ data: { currency: "eur", ...ok } }));
    await fails(prisma.fxRate.create({ data: { currency: "RUB", rateToInr: 0, asOf: ok.asOf } }));
  });

  test("a country or source that colleges depend on cannot be deleted", async () => {
    const c = await anyCountry();
    await prisma.college.create({ data: { slug: "c2", name: "C2", city: "Y", kind: "ABROAD", countryId: c.id } });
    await fails(prisma.country.delete({ where: { id: c.id } }));
  });
});
