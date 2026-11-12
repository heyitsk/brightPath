import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { seedReferenceData } from "../prisma/seed/reference";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs } from "./admin-helpers";

const emails: string[] = [];
type H = Record<string, string>;

async function wipe() {
  await prisma.nmcNotice.deleteMany();
  await prisma.college.deleteMany();
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

async function as(role: "ADMIN" | "EDITOR" | "COUNSELLOR" = "EDITOR") {
  const u = await createStaff(role);
  emails.push(u.email);
  return loginAs(u.email);
}

const csv = (text: string) => new TextEncoder().encode(text);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const auditCount = (action: string, entityId?: string) => prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });
const fieldPaths = (r: { body: unknown }): string[] => ((r.body as any).error.fields ?? []).map((f: any) => f.path);
const body = (r: { body: unknown }) => r.body as any;

async function xlsx(header: string[], rows: unknown[][], sheet = "Sheet1") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function upload(h: H, kind: string, bytes: Uint8Array, name = "file.csv", qs = "") {
  const fd = new FormData();
  fd.append("file", new File([bytes as BlobPart], name));
  return call(`/admin/imports?kind=${kind}${qs}`, { method: "POST", headers: h, body: fd });
}
const commit = (h: H, id: string, json?: unknown) => call(`/admin/imports/${id}/commit`, { method: "POST", headers: h, ...(json ? { json } : {}) });

async function newCollege(h: H, name: string, over: Record<string, unknown> = {}) {
  const ru = await prisma.country.findUniqueOrThrow({ where: { slug: "russia" } });
  const r = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name, city: "Kazan", countryId: ru.id, courseLengthMonths: 24, ...over } });
  expect(r.status).toBe(201);
  return body(r).college.id as string;
}
const addRate = (currency = "USD", rateToInr = 88.5) => prisma.fxRate.create({ data: { currency, rateToInr, asOf: new Date("2026-11-01") } });
const feeRows = (collegeId: string) => prisma.collegeFeeLine.findMany({ where: { collegeId }, orderBy: { yearNumber: "asc" } });

describe("access and the upload request itself", () => {
  test("anonymous 401, counsellor 403, write without the CSRF header 403", async () => {
    expect((await call("/admin/imports")).status).toBe(401);
    expect((await call("/admin/imports", { headers: await as("COUNSELLOR") })).status).toBe(403);
    const editor = await as();
    const { "x-bp-admin": _drop, ...readOnly } = editor;
    expect((await upload(readOnly, "COLLEGES", csv("Country,College,City\nRussia,A,B\n"))).status).toBe(403);
    expect((await call("/admin/imports", { headers: editor })).status).toBe(200);
  });

  test("a bad request is refused plainly: no file, unknown kind, empty file, unreadable file, wrong columns", async () => {
    const h = await as();
    const noFile = await call("/admin/imports?kind=COLLEGES", { method: "POST", headers: h, body: new FormData() });
    expect(noFile.status).toBe(422);
    expect((await upload(h, "PEOPLE", csv("x"))).status).toBe(422);
    const empty = await upload(h, "COLLEGES", new Uint8Array(), "empty.csv");
    expect([empty.status, fieldPaths(empty)]).toEqual([422, ["file"]]);
    const pdf = await upload(h, "COLLEGES", csv("%PDF"), "notes.pdf");
    expect([pdf.status, fieldPaths(pdf)]).toEqual([422, ["file"]]);
    const wrong = await upload(h, "COLLEGES", csv("Foo,Bar\n1,2\n"));
    expect(body(wrong).error.message).toContain('needs a header row with at least the columns "College" and "Country"');
    const wrongFees = await upload(h, "FEES", csv("Country,College,City\nRussia,A,B\n"));
    expect(body(wrongFees).error.message).toContain('"College" (or "Slug"), "Year", "Tuition" and "Currency"');
    expect(await prisma.importBatch.count()).toBe(0); // nothing is recorded for a file that could not be read
  });
});

describe("templates", () => {
  test("each kind downloads as CSV, and the colleges template can itself be uploaded", async () => {
    const h = await as();
    const t = await call("/admin/imports/templates/COLLEGES", { headers: h });
    expect(t.status).toBe(200);
    expect(t.headers.get("content-type")).toContain("text/csv");
    expect(t.headers.get("content-disposition")).toContain("colleges-template.csv");
    expect(t.text.split("\r\n")[0]).toContain("Course length (months)");

    const up = await upload(h, "COLLEGES", csv(t.text), "template.csv");
    expect(up.status).toBe(201);
    expect(body(up).preview).toMatchObject({ totalRows: 2, counts: { CREATE: 2, ERROR: 0 }, ignoredColumns: [] });

    const f = await call("/admin/imports/templates/FEES", { headers: h });
    expect(f.text.split("\r\n")[0]).toBe("College,Country,Year,Tuition,Hostel,Other,Currency,Source URL,Source,Checked on");
    const fup = await upload(h, "FEES", csv(f.text), "fees.csv"); // the example college does not exist -> row errors, but the file is understood
    expect(fup.status).toBe(201);
    expect(body(fup).preview).toMatchObject({ totalRows: 2, counts: { ERROR: 2 }, ignoredColumns: [] });
    expect((await call("/admin/imports/templates/PEOPLE", { headers: h })).status).toBe(422);
  });
});

describe("the upload -> preview -> save workflow", () => {
  const sheet = (n = 2) => csv("Country,College,City\n" + Array.from({ length: n }, (_, i) => `Russia,College ${i + 1},Kazan`).join("\n") + "\n");

  test("upload previews without saving anything; the preview can be fetched again; saving writes it once", async () => {
    const h = await as();
    const bytes = await xlsx(["Country", "College", "City"], [["Russia", "Altai", "Barnaul"], ["Georgia", "Alte", "Tbilisi"]], "All colleges");
    const up = await upload(h, "COLLEGES", bytes, "list.xlsx");
    expect(up.status).toBe(201);
    const id = body(up).batch.id as string;
    expect(body(up).batch).toMatchObject({ kind: "COLLEGES", status: "VALIDATED", filename: "list.xlsx", result: null, committedAt: null });
    expect(body(up).preview).toMatchObject({ sheet: "All colleges", totalRows: 2, canSave: true, hasErrors: false, counts: { CREATE: 2 }, groups: { Russia: 1, Georgia: 1 } });
    expect(await prisma.college.count()).toBe(0);

    const get = await call(`/admin/imports/${id}`, { headers: h });
    expect(body(get).preview.counts.CREATE).toBe(2);
    const listed = body(await call("/admin/imports?status=VALIDATED", { headers: h }));
    expect(listed.items.map((b: any) => b.id)).toEqual([id]);

    const saved = await commit(h, id);
    expect(saved.status).toBe(200);
    expect(body(saved)).toMatchObject({ result: { created: 2, updated: 0 }, batch: { status: "COMMITTED", result: { created: 2, updated: 0 } } });
    expect(await prisma.college.count()).toBe(2);

    const after = body(await call(`/admin/imports/${id}`, { headers: h }));
    expect(after.preview).toBeNull();
    expect(after.batch).toMatchObject({ status: "COMMITTED", counts: { CREATE: 2 } });
    expect((await commit(h, id)).status).toBe(409);
    expect(await auditCount("import.upload", id)).toBe(1);
    expect(await auditCount("import.commit", id)).toBe(1);
  });

  test("two people pressing Save at once: exactly one wins, nothing is created twice", async () => {
    const h = await as();
    const id = body(await upload(h, "COLLEGES", sheet(3))).batch.id;
    const results = await Promise.all([commit(h, id), commit(h, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.college.count()).toBe(3);
  });

  test("the preview is recomputed when saving: a college added by hand in between is not created twice", async () => {
    const h = await as();
    const id = body(await upload(h, "COLLEGES", csv("Country,College,City\nRussia,Altai State Medical University,Barnaul\n"))).batch.id;
    await newCollege(h, "Altai State Medical University");
    expect(body(await call(`/admin/imports/${id}`, { headers: h })).preview.counts).toMatchObject({ CREATE: 0, UNCHANGED: 1 });
    const saved = await commit(h, id);
    expect(body(saved).result).toEqual({ created: 0, updated: 0 });
    expect(await prisma.college.count()).toBe(1);
  });

  test("rows with problems: errors come first, saving is refused and names the rows, 'skip bad rows' saves only the valid ones", async () => {
    const h = await as();
    const up = await upload(h, "COLLEGES", csv("Country,College,City\nRussia,Good One,Kazan\nAtlantis,Bad One,Nowhere\nRussia,Good Two,Ufa\n"));
    expect(body(up).preview).toMatchObject({ hasErrors: true, canSave: true, counts: { CREATE: 2, ERROR: 1 } });
    expect(body(up).preview.items[0]).toMatchObject({ action: "ERROR", line: 3, label: "Bad One" });
    const id = body(up).batch.id;

    const refused = await commit(h, id);
    expect(refused.status).toBe(422);
    expect(body(refused).error.message).toContain("1 row has a problem, so nothing was saved");
    expect(fieldPaths(refused)).toEqual(["row 3"]);
    expect(await prisma.college.count()).toBe(0);

    const ok = await commit(h, id, { skipBadRows: true });
    expect(body(ok).result).toEqual({ created: 2, updated: 0 });
    const detail = body(await call(`/admin/imports/${id}`, { headers: h }));
    expect(detail.errors).toEqual([{ line: 3, label: "Bad One", message: expect.stringContaining("Atlantis") }]); // kept as a record
  });

  test("preview can be filtered by action and paged; the order is errors first otherwise", async () => {
    const h = await as();
    await newCollege(h, "College 1"); // exists already -> UNCHANGED
    const up = await upload(h, "COLLEGES", csv("Country,College,City\nRussia,College 1,Kazan\nRussia,College 2,Kazan\nRussia,College 3,Kazan\nAtlantis,College 4,X\n"));
    const id = body(up).batch.id;
    expect(body(up).preview.items.map((i: any) => i.action)).toEqual(["ERROR", "CREATE", "CREATE", "UNCHANGED"]);
    const q = async (qs: string) => body(await call(`/admin/imports/${id}${qs}`, { headers: h })).preview;
    expect((await q("?action=CREATE")).items.map((i: any) => i.line)).toEqual([3, 4]);
    expect((await q("?action=CREATE&limit=1&offset=1")).items.map((i: any) => i.line)).toEqual([4]);
    expect(await q("?action=CREATE&limit=1")).toMatchObject({ itemsTotal: 2, offset: 0 });
    expect((await call(`/admin/imports/${id}?limit=0`, { headers: h })).status).toBe(422);
    expect((await call(`/admin/imports/${id}?action=NOPE`, { headers: h })).status).toBe(422);
  });

  test("an unsaved upload can be discarded; a saved one is kept as a record", async () => {
    const h = await as();
    const id = body(await upload(h, "COLLEGES", sheet())).batch.id;
    expect((await call(`/admin/imports/${id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await call(`/admin/imports/${id}`, { headers: h })).status).toBe(404);
    expect((await call(`/admin/imports/${id}`, { method: "DELETE", headers: h })).status).toBe(404);
    expect((await commit(h, id)).status).toBe(404);
    expect(await auditCount("import.discard", id)).toBe(1);

    const kept = body(await upload(h, "COLLEGES", sheet())).batch.id;
    await commit(h, kept);
    expect((await call(`/admin/imports/${kept}`, { method: "DELETE", headers: h })).status).toBe(409);
  });

  test("the same file twice shows a notice that it was already saved", async () => {
    const h = await as();
    const bytes = sheet();
    const first = body(await upload(h, "COLLEGES", bytes)).batch.id;
    await commit(h, first);
    const again = await upload(h, "COLLEGES", bytes);
    expect(body(again).preview.notices.join(" ")).toContain("already saved on");
    expect(body(again).preview.canSave).toBe(false);
  });

  test("list filters by kind and status, newest first", async () => {
    const h = await as();
    const a = body(await upload(h, "COLLEGES", sheet(1))).batch.id;
    const b = body(await upload(h, "COLLEGES", sheet(2))).batch.id;
    await commit(h, a);
    const all = body(await call("/admin/imports", { headers: h }));
    expect(all.items.map((x: any) => x.id)).toEqual([b, a]);
    expect(body(await call("/admin/imports?status=COMMITTED", { headers: h })).items.map((x: any) => x.id)).toEqual([a]);
    expect(body(await call("/admin/imports?kind=FEES", { headers: h })).items).toEqual([]);
  });
});

describe("fees upload", () => {
  const HEADER = "College,Country,Year,Tuition,Hostel,Other,Currency,Source URL,Source,Checked on\n";

  test("creates fee rows, creates a new source once for a shared web address, reprices the college", async () => {
    const h = await as();
    const id = await newCollege(h, "Kazan Sample University");
    await addRate();
    const text = HEADER +
      "Kazan Sample University,Russia,1,5000,900,400,USD,https://example.edu/fees,University fee notice,2026-11-01\n" +
      "Kazan Sample University,Russia,2,5200,\"1,000\",400,usd,https://example.edu/fees,University fee notice,01/11/2026\n";
    const up = await upload(h, "FEES", csv(text));
    expect(body(up).preview).toMatchObject({ counts: { CREATE: 2, ERROR: 0 }, groups: { "Kazan Sample University": 2 } });
    expect(body(up).preview.items[0]).toMatchObject({ label: "Kazan Sample University, year 1", detail: "Year 1: USD 6,300 (about ₹557,550)".replace("557,550", (557550).toLocaleString("en-IN")) });
    expect(await feeRows(id)).toHaveLength(0);

    const saved = await commit(h, body(up).batch.id);
    expect(body(saved).result).toEqual({ created: 2, updated: 0, colleges: 1, sourcesCreated: 1 });
    const rows = await feeRows(id);
    expect(rows.map((r) => [r.yearNumber, Number(r.tuition), Number(r.hostel), r.currency])).toEqual([[1, 5000, 900, "USD"], [2, 5200, 1000, "USD"]]);
    expect(rows[0]!.checkedAt!.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(rows[1]!.checkedAt!.toISOString().slice(0, 10)).toBe("2026-11-01"); // 01/11/2026 is day/month/year
    expect(new Set(rows.map((r) => r.sourceId)).size).toBe(1);
    const src = await prisma.source.findUniqueOrThrow({ where: { id: rows[0]!.sourceId! } });
    expect(src).toMatchObject({ title: "University fee notice", url: "https://example.edu/fees" });
    expect((await prisma.college.findUniqueOrThrow({ where: { id } })).totalCourseFeeInr).toBe(Math.round(6300 * 88.5) + Math.round(6600 * 88.5));
  });

  test("an existing source is matched by web address or title and not duplicated", async () => {
    const h = await as();
    await newCollege(h, "Kazan Sample University");
    await addRate();
    const s = await prisma.source.create({ data: { kind: "OTHER", title: "Official Fee Notice", url: "https://example.edu/fees" } });
    const t = HEADER +
      "Kazan Sample University,,1,5000,,,USD,https://example.edu/fees,,\n" +
      "Kazan Sample University,,2,5000,,,USD,,official fee notice,\n";
    const up = await upload(h, "FEES", csv(t));
    expect(body(up).preview.counts).toMatchObject({ CREATE: 2, ERROR: 0 });
    const saved = await commit(h, body(up).batch.id);
    expect(body(saved).result.sourcesCreated).toBe(0);
    expect(await prisma.source.count()).toBe(1);
    expect((await prisma.collegeFeeLine.findMany()).every((f) => f.sourceId === s.id)).toBe(true);
  });

  test("a later upload replaces stored fees: the preview lists each old -> new value; identical rows are unchanged", async () => {
    const h = await as();
    const id = await newCollege(h, "Kazan Sample University");
    await addRate();
    const base = HEADER + "Kazan Sample University,,1,5000,900,400,USD,https://example.edu/fees,,2026-11-01\nKazan Sample University,,2,5000,900,400,USD,https://example.edu/fees,,2026-11-01\n";
    await commit(h, body(await upload(h, "FEES", csv(base))).batch.id);

    const next = HEADER + "Kazan Sample University,,1,5500,900,400,USD,https://example.edu/fees,,2026-11-01\nKazan Sample University,,2,5000,900,400,USD,https://example.edu/fees,,2026-11-01\n";
    const up = await upload(h, "FEES", csv(next));
    const items = body(up).preview.items;
    expect(body(up).preview.counts).toMatchObject({ UPDATE: 1, UNCHANGED: 1, CREATE: 0 });
    expect(items[0]).toMatchObject({ action: "UPDATE", line: 2, changes: [{ field: "tuition", current: "5000", uploaded: "5500" }] });
    expect(items[0].message).toContain("Replaces the stored fees for year 1");
    expect(items[1]).toMatchObject({ action: "UNCHANGED", line: 3 });
    const saved = await commit(h, body(up).batch.id);
    expect(body(saved).result).toMatchObject({ created: 0, updated: 1 });
    expect(Number((await feeRows(id))[0]!.tuition)).toBe(5500);

    const same = await upload(h, "FEES", csv(next));
    expect(body(same).preview).toMatchObject({ canSave: false, counts: { UNCHANGED: 2 } });
  });

  test("Excel works too: numbers, real date cells and a 'Fees' sheet", async () => {
    const h = await as();
    const id = await newCollege(h, "Kazan Sample University", { courseLengthMonths: 12 });
    await addRate();
    const bytes = await xlsx(["College", "Year", "Tuition", "Hostel", "Other", "Currency", "Source URL", "Checked on"], [["Kazan Sample University", 1, 4500.5, 800, 0, "USD", "https://example.edu/f", new Date("2026-10-15")]], "Fees");
    const up = await upload(h, "FEES", bytes, "fees.xlsx");
    expect(body(up).preview).toMatchObject({ sheet: "Fees", counts: { CREATE: 1, ERROR: 0 } });
    await commit(h, body(up).batch.id);
    const [row] = await feeRows(id);
    expect([Number(row!.tuition), Number(row!.hostel), row!.checkedAt!.toISOString().slice(0, 10)]).toEqual([4500.5, 800, "2026-10-15"]);
  });

  test("each kind of bad row is explained: unknown or ambiguous college, year, amounts, currency, source, duplicates", async () => {
    const h = await as();
    const ru = await newCollege(h, "Twin University", { courseLengthMonths: 24 });
    const kz = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "Twin University", city: "Almaty", countryId: (await prisma.country.findUniqueOrThrow({ where: { slug: "kazakhstan" } })).id, courseLengthMonths: 24 } });
    expect(kz.status).toBe(201);
    const slugKz = body(kz).college.slug;
    await newCollege(h, "Solo University", { courseLengthMonths: 24 });
    const t = HEADER +
      "Nowhere University,,1,100,,,USD,,,\n" +
      "Twin University,,1,100,,,USD,,,\n" +
      "Twin University,Kazakhstan,1,100,,,USD,,,\n" +
      "Solo University,,3,100,,,USD,,,\n" +
      "Solo University,,x,100,,,USD,,,\n" +
      "Solo University,,1,abc,,,USD,,,\n" +
      "Solo University,,1,100.123,,,USD,,,\n" +
      "Solo University,,1,100,,,US,,,\n" +
      "Solo University,,1,100,,,,,,\n" +
      "Solo University,,1,100,,,USD,,Unknown Notice,\n" +
      "Solo University,,1,100,,,USD,ftp://x,,\n" +
      "Solo University,,1,100,,,USD,,,2099-01-01\n" +
      "Solo University,,2,100,,,USD,,,\n" +
      "Solo University,,2,200,,,USD,,,\n" +
      ",,1,100,,,USD,,,\n";
    const up = await upload(h, "FEES", csv(t));
    const by = Object.fromEntries(body(up).preview.items.map((i: any) => [i.line, i]));
    expect(by[2].message).toContain('There is no college named "Nowhere University"');
    expect(by[3].message).toContain('More than one college is named "Twin University"');
    expect(by[4].action).toBe("CREATE");
    expect(by[4].targetId).not.toBe(ru);
    expect(by[5].message).toContain("there is no year 3");
    expect(by[6].message).toContain("Year");
    expect(by[7].message).toContain('Tuition "abc" is not a number');
    expect(by[8].message).toContain("more than 2 decimal places");
    expect(by[9].message).toContain('Currency "US" must be a 3-letter code');
    expect(by[10].message).toContain("Currency is empty");
    expect(by[11].message).toContain('Source "Unknown Notice" is not in the sources list');
    expect(by[12].message).toContain("Source URL");
    expect(by[13].message).toContain("in the future");
    expect(by[14].action).toBe("CREATE");
    expect(by[15].message).toContain("year 2 appears twice");
    expect(by[16].message).toContain("College is empty");

    // Slug column resolves a twin directly.
    const bySlug = await upload(h, "FEES", csv("Slug,Year,Tuition,Currency\n" + `${slugKz},1,100,USD\nnope-slug,1,100,USD\n`));
    expect(body(bySlug).preview.items.map((i: any) => i.action).sort()).toEqual(["CREATE", "ERROR"]);
  });

  test("warnings: a row without a source or without an exchange rate can be saved for a draft, but says what is missing", async () => {
    const h = await as();
    await newCollege(h, "Kazan Sample University");
    const up = await upload(h, "FEES", csv(HEADER + "Kazan Sample University,,1,5000,,,USD,,,\n"));
    const item = body(up).preview.items[0];
    expect(item.action).toBe("CREATE");
    expect(item.warnings.join(" ")).toContain("No source given");
    expect(item.warnings.join(" ")).toContain("no USD exchange rate");
    expect(item.detail).toBe("Year 1: USD 5,000");
    await commit(h, body(up).batch.id);
    const c = (await prisma.college.findFirstOrThrow({ include: { feeLines: true } }));
    expect([c.feeLines[0]!.sourceId, c.totalCourseFeeInr]).toEqual([null, null]);
  });

  test("a live college is protected: rows that would leave it without a source or an exchange rate are errors; good rows go through and re-price it", async () => {
    const h = await as();
    await addRate("USD", 88.5);
    const id = await newCollege(h, "Live University", { courseLengthMonths: 12 });
    const src = (await prisma.source.create({ data: { kind: "OTHER", title: "Notice", url: "https://example.edu/n" } })).id;
    await call(`/admin/colleges/${id}/fees/1`, { method: "PUT", headers: h, json: { tuition: 1000, currency: "USD", sourceId: src } });
    await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { ownership: "GOVERNMENT", description: "Text.", abroad: { wdomsListed: "LISTED", wdomsCheckedAt: daysAgo(3), teachingLanguage: "English", intakeMonths: [9], nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: daysAgo(3) } } });
    await call(`/admin/colleges/${id}/sources`, { method: "POST", headers: h, json: { sourceId: src, purpose: "FEE_NOTICE", checkedAt: daysAgo(1) } });
    expect((await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h })).status).toBe(200);

    const noSource = await upload(h, "FEES", csv(HEADER + "Live University,,1,2000,,,USD,,,\n"));
    expect(body(noSource).preview.items[0]).toMatchObject({ action: "ERROR" });
    expect(body(noSource).preview.items[0].message).toContain("is live, so every fee row needs a source");
    const noRate = await upload(h, "FEES", csv(HEADER + "Live University,,1,2000,,,EUR,https://example.edu/n,,\n"));
    expect(body(noRate).preview.items[0].message).toContain("there is no EUR exchange rate");

    const good = await upload(h, "FEES", csv(HEADER + "Live University,,1,2000,0,0,USD,https://example.edu/n,,\n"));
    expect(body(good).preview.counts).toMatchObject({ UPDATE: 1, ERROR: 0 });
    await commit(h, body(good).batch.id);
    expect(await prisma.college.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "READY", totalCourseFeeInr: 177000 });
  });

  test("saving is all or nothing: a late failure rolls back every row and new source", async () => {
    const h = await as();
    await addRate();
    const id = await newCollege(h, "Kazan Sample University");
    const up = await upload(h, "FEES", csv(HEADER + "Kazan Sample University,,1,100,,,USD,https://example.edu/a,,\nKazan Sample University,,2,100,,,USD,https://example.edu/a,,\n"));
    // Make the second row impossible after the preview: the college's course is shortened to 1 year before saving.
    await prisma.college.update({ where: { id }, data: { courseLengthMonths: 12 } });
    const res = await commit(h, body(up).batch.id);
    expect(res.status).toBe(422); // the recomputed plan now has an error for year 2, so nothing is saved
    expect(await feeRows(id)).toHaveLength(0);
    expect(await prisma.source.count()).toBe(0);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: body(up).batch.id } })).status).toBe("VALIDATED");
  });
});
