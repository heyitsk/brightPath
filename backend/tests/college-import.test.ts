import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { slugify, slugifyShort } from "../src/lib/slug";
import { COLLEGE_NEEDS, COLLEGE_SHEETS, COLLEGE_SPEC, collegeHeaderOk, planCollegeRows, type CollegeRow } from "../src/modules/college/college-import";
import { MAX_ROWS, extractRecords, parseAmount, parseCheckedDate, parseMonths, parseWholeNumber, readTable } from "../src/modules/imports/table";
import { commitImport, createImport } from "../src/modules/imports/imports.service";
import { seedReferenceData } from "../prisma/seed/reference";
import { cleanup, createStaff } from "./admin-helpers";

const emails: string[] = [];

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
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const csv = (text: string) => new TextEncoder().encode(text);

const rec = async (bytes: Uint8Array, name = "x.xlsx") => extractRecords(await readTable(bytes, name, COLLEGE_SHEETS), COLLEGE_SPEC, collegeHeaderOk, COLLEGE_NEEDS);
const row = (over: Partial<CollegeRow["v"]> = {}, line = 2): CollegeRow => ({ line, v: { country: "Russia", name: "Altai State Medical University", city: "Barnaul", verified: "Well-known location", ...over } });

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

describe("reading files", () => {
  test("Excel: columns are found by heading in any order, title rows and blank lines are skipped, line numbers are the sheet's", async () => {
    const buf = await workbook([["Barnaul", "Altai State Medical University", "Russia", "Checked online", "Some note"], [], [null, null, null]], { header: ["City", "College", "Country", "Verified", "Note"], titleRows: 2 });
    const r = await rec(buf);
    expect(r.ignoredColumns).toEqual([]);
    expect(r.rows).toEqual([{ line: 4, v: { city: "Barnaul", name: "Altai State Medical University", country: "Russia", verified: "Checked online", note: "Some note" } }]);
  });

  test("CSV: BOM, semicolon delimiter, quoted commas and headings in any case", async () => {
    const r = await rec(csv('﻿COLLEGE;country;City\n"Smith, Jones Medical School";Russia;Kazan\n'), "x.csv");
    expect(r.rows).toEqual([{ line: 2, v: { name: "Smith, Jones Medical School", country: "Russia", city: "Kazan" } }]);
  });

  test("columns the system does not know are reported (usually a typo) but do not stop the upload", async () => {
    const r = await rec(csv("Country,College,City,Citty,Owner\nRussia,A,B,C,D\n"), "x.csv");
    expect(r.ignoredColumns).toEqual(["Citty", "Owner"]);
    expect(r.rows[0]!.v).toEqual({ country: "Russia", name: "A", city: "B" });
  });

  test("a sheet is found by name, or used if it is the only one; otherwise the sheets are listed", async () => {
    expect((await rec(await workbook([["Russia", 1, "A", "B"]], { sheet: "Whatever" }))).rows).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("One");
    wb.addWorksheet("Two");
    await expect(readTable(new Uint8Array(await wb.xlsx.writeBuffer()), "x.xlsx", COLLEGE_SHEETS)).rejects.toThrow(/Could not find a sheet.*"One", "Two"/);
  });

  test("unusable files get a plain-words refusal that names the file problem", async () => {
    const fileError = async (p: Promise<unknown>) => {
      try { await p; } catch (e: any) { return [e.status, e.fields?.[0]?.path, e.message as string] as const; }
      return null;
    };
    await expect(rec(await workbook([]))).rejects.toThrow(/header but no data rows/);
    expect(await fileError(rec(csv("Foo,Bar\n1,2\n"), "x.csv"))).toEqual([422, "file", expect.stringContaining("needs a header row with")]);
    expect(await fileError(rec(csv("hello"), "notes.pdf"))).toEqual([422, "file", "Upload an Excel (.xlsx) or CSV (.csv) file."]);
    expect(await fileError(rec(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), "old.xls"))).toEqual([422, "file", expect.stringContaining("old Excel (.xls)")]);
    expect(await fileError(rec(csv("not really excel"), "fake.xlsx"))).toEqual([422, "file", expect.stringContaining("not a valid Excel")]);
    expect(await fileError(rec(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]), "broken.xlsx"))).toEqual([422, "file", expect.stringContaining("could not be read")]);
  });

  test(`more than ${MAX_ROWS} rows is refused`, async () => {
    const lines = ["Country,College,City", ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Russia,College ${i},X`)];
    await expect(rec(csv(lines.join("\n")), "big.csv")).rejects.toThrow(/at most 5000 rows/);
  });
});

describe("value parsers", () => {
  test("amounts accept separators and symbols but never more than 2 decimals or text", () => {
    expect(parseAmount("T", "1,500.50")).toEqual({ ok: true, value: 1500.5 });
    expect(parseAmount("T", "₹ 1500")).toEqual({ ok: true, value: 1500 });
    expect(parseAmount("T", "$4500")).toEqual({ ok: true, value: 4500 });
    expect(parseAmount("T", "12.345").ok).toBe(false);
    expect(parseAmount("T", "abc").ok).toBe(false);
    expect(parseAmount("T", "-5").ok).toBe(false);
  });
  test("whole numbers are range checked", () => {
    expect(parseWholeNumber("Year", "3", 1, 12)).toEqual({ ok: true, value: 3 });
    expect(parseWholeNumber("Year", "3.0", 1, 12)).toEqual({ ok: true, value: 3 });
    expect(parseWholeNumber("Year", "13", 1, 12).ok).toBe(false);
    expect(parseWholeNumber("Year", "2.5", 1, 12).ok).toBe(false);
  });
  test("dates: ISO or day/month/year, real dates only, not in the future", () => {
    expect((parseCheckedDate("D", "2026-11-01") as any).value.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect((parseCheckedDate("D", "01/11/2026") as any).value.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect((parseCheckedDate("D", "1-11-2026") as any).value.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parseCheckedDate("D", "31/02/2026").ok).toBe(false);
    expect(parseCheckedDate("D", "2099-01-01").ok).toBe(false);
    expect(parseCheckedDate("D", "last week").ok).toBe(false);
  });
  test("months by name or number, sorted and de-duplicated", () => {
    expect(parseMonths("I", "Sep; Feb")).toEqual({ ok: true, value: [2, 9] });
    expect(parseMonths("I", "September and february, 9")).toEqual({ ok: true, value: [2, 9] });
    expect(parseMonths("I", "9/2")).toEqual({ ok: true, value: [2, 9] });
    expect(parseMonths("I", "Smarch").ok).toBe(false);
    expect(parseMonths("I", "13").ok).toBe(false);
  });
});

describe("planCollegeRows", () => {
  test("plain rows become CREATE with a readable slug, grouped per country", async () => {
    const plan = await planCollegeRows([row(), row({ country: "Georgia", name: "Alte University", city: "Tbilisi" }, 3)]);
    expect(plan.counts).toMatchObject({ CREATE: 2, ERROR: 0 });
    expect(plan.items.map((i) => i.slug)).toEqual(["altai-state-medical-university", "alte-university"]);
    expect(plan.groups).toEqual({ Russia: 1, Georgia: 1 });
    expect(plan.items[0]).toMatchObject({ label: "Altai State Medical University (Russia)", detail: "Barnaul" });
  });

  test("India rows need a state (name, code or alias) and take India-only columns; foreign-only columns are ignored with a warning", async () => {
    const plan = await planCollegeRows([
      { line: 2, v: { state: "Maharashtra", name: "Pune Sample College", city: "Pune", ownership: "Govt", mbbsSeats: "150", hospital: "Sample Hospital", hospitalBeds: "800", teachingLanguage: "English" } },
      { line: 3, v: { kind: "India", state: "UP", name: "Lucknow Sample College", city: "Lucknow", ownership: "Private" } },
      { line: 4, v: { country: "India", state: "Goa", name: "Goa Sample College", city: "Panaji" } },
    ]);
    expect(plan.counts).toMatchObject({ CREATE: 3, ERROR: 0 });
    expect(plan.items[0]!.apply).toMatchObject({ kind: "INDIA", countryId: null, base: { ownership: "GOVERNMENT" }, india: { mbbsSeats: 150, hospitalName: "Sample Hospital", hospitalBeds: 800 } });
    expect(plan.items[0]!.apply!.stateId).not.toBeNull();
    expect(plan.items[0]!.warnings[0]).toContain("only applies to foreign colleges");
    expect(plan.items[1]!.label).toBe("Lucknow Sample College (Uttar Pradesh)");
    expect(plan.groups).toEqual({ Maharashtra: 1, "Uttar Pradesh": 1, Goa: 1 });
  });

  test("foreign rows take foreign-only columns: language, intake months, internship, seats", async () => {
    const plan = await planCollegeRows([row({ teachingLanguage: "English", intake: "Sep; Feb", internship: "12", seatsForIndians: "50", ownership: "government", established: "1804", courseLength: "72", website: "https://example.edu" })]);
    expect(plan.items[0]!.apply).toMatchObject({
      kind: "ABROAD", stateId: null,
      base: { ownership: "GOVERNMENT", establishedYear: 1804, courseLengthMonths: 72, websiteUrl: "https://example.edu/", locationBasis: "WELL_KNOWN" },
      abroad: { teachingLanguage: "English", intakeMonths: [2, 9], internshipMonths: 12, seatsForIndians: 50 },
    });
  });

  test("problems are explained per row and do not stop the other rows", async () => {
    const plan = await planCollegeRows([
      row({ country: "Atlantis" }, 2), row({ city: "" }, 3), row({ verified: "Trust me" }, 4), row({ country: "" }, 5), row({ name: "!!!" }, 6),
      row({ name: "A".repeat(201) }, 7), row({ name: "Fine University" }, 8),
      row({ name: "Bad Values", ownership: "Cooperative", established: "1066", courseLength: "5", website: "ftp://x", intake: "Smarch" }, 9),
      { line: 10, v: { state: "Atlantis", name: "X", city: "Y" } },
      { line: 11, v: { kind: "India", name: "X", city: "Y" } },
      { line: 12, v: { kind: "India", country: "Russia", state: "Goa", name: "X", city: "Y" } },
      row({ kind: "Moon" }, 13),
    ]);
    const by = Object.fromEntries(plan.items.map((i) => [i.line, i]));
    expect(by[2]!.message).toContain('Country "Atlantis" is not in the countries list');
    expect(by[3]!.message).toBe("City is empty.");
    expect(by[4]!.message).toContain('"Trust me" is not a known value for Verified');
    expect(by[5]!.message).toContain("Country is empty");
    expect(by[6]!.message).toContain("no letters or digits");
    expect(by[7]!.message).toContain("longer than 200");
    expect(by[8]!.action).toBe("CREATE");
    for (const part of ['Ownership "Cooperative"', "Established year", "Course length", "Website", "Intake"]) expect(by[9]!.message).toContain(part);
    expect(by[10]!.message).toContain('State "Atlantis"');
    expect(by[11]!.message).toContain("State is empty");
    expect(by[12]!.message).toContain("cannot have the country");
    expect(by[13]!.message).toContain('"Moon" is not a known Kind');
    expect(plan.counts).toMatchObject({ ERROR: 11, CREATE: 1 });
  });

  test("country names are matched ignoring case and via aliases; a foreign row with a state is refused", async () => {
    const plan = await planCollegeRows([row({ country: "russia" }), row({ name: "X", country: "Kyrgyz" }, 3), row({ name: "Y", country: "Curaçao" }, 4), { line: 5, v: { country: "Russia", state: "Goa", name: "Z", city: "Q" } }]);
    expect(plan.counts).toMatchObject({ CREATE: 3, ERROR: 1 });
    expect(plan.items[3]!.message).toContain("both a Country and a State");
  });

  test("the same college twice in one file is an error for the second row", async () => {
    const plan = await planCollegeRows([row(), row({ name: "ALTAI STATE MEDICAL UNIVERSITY" }, 3)]);
    expect(plan.items[1]).toMatchObject({ action: "ERROR" });
    expect(plan.items[1]!.message).toContain("appears twice for Russia");
  });

  test("two different colleges with the same name get different slugs", async () => {
    const plan = await planCollegeRows([
      row({ name: "International Medical School" }),
      row({ name: "International Medical School", country: "Kazakhstan", city: "Almaty" }, 3),
      { line: 4, v: { state: "Goa", name: "International Medical School", city: "Panaji" } },
    ]);
    expect(plan.items.map((i) => i.slug)).toEqual(["international-medical-school", "international-medical-school-kazakhstan", "international-medical-school-goa"]);
  });
});

describe("saving: createImport + commitImport", () => {
  const base = [["Russia", 1, "Altai State Medical University", "Barnaul", "Well-known location", "Check the city"], ["Georgia", 2, "Alte University", "Tbilisi", "Checked online", ""]];
  const upload = async (rows: unknown[][]) => {
    const a = await actor();
    return { a, ...(await createImport(a, "COLLEGES", "list.xlsx", await workbook(rows))) };
  };

  test("creates drafts with empty profiles, records the batch, result and audit; the preview itself writes nothing", async () => {
    const { a, batch, preview } = await upload(base);
    expect(batch).toMatchObject({ kind: "COLLEGES", status: "VALIDATED", filename: "list.xlsx" });
    expect(preview).toMatchObject({ totalRows: 2, canSave: true, hasErrors: false, counts: { CREATE: 2 } });
    expect(await prisma.college.count()).toBe(0);
    const saved = await commitImport(a, batch.id);
    expect(saved.result).toEqual({ created: 2, updated: 0 });
    expect(saved.batch).toMatchObject({ status: "COMMITTED", result: { created: 2, updated: 0 } });

    const colleges = await prisma.college.findMany({ include: { abroadProfile: true, country: true }, orderBy: { name: "asc" } });
    for (const c of colleges) {
      expect(c).toMatchObject({ kind: "ABROAD", status: "DRAFT", readyAt: null, stateId: null, totalCourseFeeInr: null, importBatchId: batch.id });
      expect(c.abroadProfile).toMatchObject({ wdomsListed: "UNKNOWN", intakeMonths: [] });
    }
    expect(colleges[0]).toMatchObject({ name: "Altai State Medical University", locationBasis: "WELL_KNOWN", internalNotes: "Check the city" });
    expect(colleges[1]).toMatchObject({ name: "Alte University", locationBasis: "CHECKED_ONLINE", city: "Tbilisi", internalNotes: null });
    expect(await prisma.auditLog.count({ where: { action: "import.commit", entityId: batch.id } })).toBe(1);
  });

  test("India colleges are created with an India profile", async () => {
    const a = await actor();
    const { batch } = await createImport(a, "COLLEGES", "in.csv", csv("State,College,City,Ownership,MBBS seats,Hospital\nMaharashtra,Pune Sample College,Pune,Government,150,Sample Hospital\n"));
    await commitImport(a, batch.id);
    const c = await prisma.college.findFirstOrThrow({ include: { indiaProfile: true, abroadProfile: true, state: true } });
    expect(c).toMatchObject({ kind: "INDIA", status: "DRAFT", countryId: null, ownership: "GOVERNMENT", state: { code: "MH" }, abroadProfile: null });
    expect(c.indiaProfile).toMatchObject({ mbbsSeats: 150, hospitalName: "Sample Hospital" });
  });

  test("uploading the same list again plans nothing new; saving one upload twice is refused", async () => {
    const a = await actor();
    const bytes = await workbook(base); // the very same file both times (an .xlsx embeds its creation time, so rebuilding it would differ)
    const { batch } = await createImport(a, "COLLEGES", "list.xlsx", bytes);
    await commitImport(a, batch.id);
    await expect(commitImport(a, batch.id)).rejects.toThrow(/already saved/);
    const again = await createImport(a, "COLLEGES", "list.xlsx", bytes);
    expect(again.preview.counts).toMatchObject({ CREATE: 0, UNCHANGED: 2 });
    expect(again.preview.canSave).toBe(false);
    expect(again.preview.notices.join(" ")).toContain("already saved");
    expect(await prisma.college.count()).toBe(2);
  });

  test("staff edits survive: stored values are kept (and reported), only empty fields are filled", async () => {
    const a = await actor();
    const first = await createImport(a, "COLLEGES", "a.csv", csv("Country,College,City\nRussia,Altai State Medical University,Barnaul\n"));
    await commitImport(a, first.batch.id);
    await prisma.college.updateMany({ data: { city: "Edited City", ownership: "PRIVATE" } });

    const second = await createImport(a, "COLLEGES", "b.csv", csv("Country,College,City,Ownership,Course length (months),Verified,Note\nRussia,Altai State Medical University,Barnaul,Government,72,Checked online,From the list\n"));
    const item = second.preview.items[0]!;
    expect(item.action).toBe("UPDATE");
    expect(item.changes.map((c) => c.field).sort()).toEqual(["city check", "course length (months)", "note"]);
    expect(item.warnings.join(" ")).toContain('Kept the stored city "Edited City"');
    expect(item.warnings.join(" ")).toContain('Kept the stored ownership "PRIVATE"');
    await commitImport(a, second.batch.id);
    expect(await prisma.college.findFirstOrThrow()).toMatchObject({ city: "Edited City", ownership: "PRIVATE", courseLengthMonths: 72, locationBasis: "CHECKED_ONLINE", internalNotes: "From the list" });
  });

  test("an existing archived college with nothing to fill is skipped and reported", async () => {
    const a = await actor();
    const text = "Country,College,City\nRussia,Altai State Medical University,Barnaul\n";
    const first = await createImport(a, "COLLEGES", "a.csv", csv(text));
    await commitImport(a, first.batch.id);
    await prisma.college.updateMany({ data: { status: "ARCHIVED" } });
    const again = await createImport(a, "COLLEGES", "a.csv", csv(text));
    expect(again.preview.items[0]).toMatchObject({ action: "SKIP", message: "Already archived; left as it is." });
  });

  test("a file with problem rows cannot be saved unless the bad rows are skipped; the bad rows are never written", async () => {
    const a = await actor();
    const { batch, preview } = await createImport(a, "COLLEGES", "x.csv", csv("Country,College,City\nRussia,Good One,Kazan\nAtlantis,Bad One,Nowhere\n"));
    expect(preview).toMatchObject({ hasErrors: true, canSave: true, counts: { CREATE: 1, ERROR: 1 } });
    expect(preview.items[0]).toMatchObject({ action: "ERROR", line: 3 }); // errors are listed first
    try {
      await commitImport(a, batch.id);
      throw new Error("should have been refused");
    } catch (e: any) {
      expect(e.status).toBe(422);
      expect(e.message).toContain("nothing was saved");
      expect(e.fields[0]).toMatchObject({ path: "row 3" });
    }
    expect(await prisma.college.count()).toBe(0);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("VALIDATED");
    const saved = await commitImport(a, batch.id, { skipBadRows: true });
    expect(saved.result.created).toBe(1);
    expect(await prisma.college.count()).toBe(1);
  });
});
