import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { seedReferenceData } from "../prisma/seed/reference";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs, WRITE } from "./admin-helpers";

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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const auditCount = (action: string, entityId?: string) => prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });
const college = (r: { body: unknown }) => (r.body as any).college;
const fieldPaths = (r: { body: unknown }): string[] => ((r.body as any).error.fields ?? []).map((f: any) => f.path);

const country = (slug = "russia") => prisma.country.findUniqueOrThrow({ where: { slug } });
const state = (code = "MH") => prisma.state.findUniqueOrThrow({ where: { code } });
const addRate = (currency = "USD", rateToInr = 88.5) => prisma.fxRate.create({ data: { currency, rateToInr, asOf: new Date("2026-11-01") } });

async function newSource(h: H, title = "Fee notice") {
  const r = await call("/admin/sources", { method: "POST", headers: h, json: { kind: "COLLEGE_WEBSITE", title, url: "https://example.com/fees" } });
  return (r.body as any).source.id as string;
}

async function createAbroad(h: H, over: Record<string, unknown> = {}) {
  const r = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "Kazan Sample University", city: "Kazan", countryId: (await country()).id, ...over } });
  expect(r.status).toBe(201);
  return college(r);
}

const abroadDetails = {
  ownership: "GOVERNMENT", description: "A short description.", courseLengthMonths: 72,
  abroad: {
    wdomsListed: "LISTED", wdomsCheckedAt: daysAgo(3), teachingLanguage: "English", intakeMonths: [9, 2, 9],
    nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: daysAgo(3),
  },
};

const fee = (sourceId: string | null, over: Record<string, unknown> = {}) => ({ tuition: 5000, hostel: 1000, other: 500, currency: "USD", sourceId, ...over });

/** Brings an abroad draft to "everything filled" through the API, step by step, like the admin screen would. */
async function completeAbroad(h: H, id: string, sourceId: string, years = 6) {
  expect((await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: abroadDetails })).status).toBe(200);
  for (let y = 1; y <= years; y++) expect((await call(`/admin/colleges/${id}/fees/${y}`, { method: "PUT", headers: h, json: fee(sourceId) })).status).toBe(200);
  expect((await call(`/admin/colleges/${id}/sources`, { method: "POST", headers: h, json: { sourceId, purpose: "FEE_NOTICE", checkedAt: daysAgo(2) } })).status).toBe(201);
}

async function readyAbroad(h: H, over: Record<string, unknown> = {}) {
  await addRate();
  const c = await createAbroad(h, over);
  const src = await newSource(h);
  await completeAbroad(h, c.id, src);
  const r = await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h });
  expect(r.status).toBe(200);
  return { id: c.id as string, src, college: college(r) };
}

describe("access", () => {
  test("anonymous 401, counsellor 403, write without the CSRF header 403", async () => {
    expect((await call("/admin/colleges")).status).toBe(401);
    const counsellor = await as("COUNSELLOR");
    expect((await call("/admin/colleges", { headers: counsellor })).status).toBe(403);
    const editor = await as("EDITOR");
    const { "x-bp-admin": _drop, ...readOnly } = editor;
    const r = await call("/admin/colleges", { method: "POST", headers: readOnly, json: { kind: "ABROAD", name: "X", city: "Y" } });
    expect(r.status).toBe(403);
    expect((await call("/admin/colleges", { headers: editor })).status).toBe(200);
  });
});

describe("create", () => {
  test("a new college is always a draft with a slug from its name, an empty profile and an audit entry", async () => {
    const h = await as();
    const c = await createAbroad(h);
    expect(c).toMatchObject({
      kind: "ABROAD", status: "DRAFT", slug: "kazan-sample-university", name: "Kazan Sample University", readyAt: null, totalCourseFeeInr: null,
      country: { slug: "russia" }, state: null, india: null, fees: [], sources: [], faqs: [],
    });
    expect(c.abroad).toMatchObject({ wdomsListed: "UNKNOWN", intakeMonths: [], meetsNmc2021: "UNKNOWN" });
    expect(await auditCount("college.create", c.id)).toBe(1);
  });

  test("it cannot be created live, and unknown fields are refused rather than ignored", async () => {
    const h = await as();
    const c = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "X", city: "Y", status: "READY" } });
    expect([c.status, fieldPaths(c)]).toEqual([422, ["status"]]);
    expect(((c.body as any).error.fields[0].message as string)).toContain("Mark ready");
    const slug = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "X", city: "Y", slug: "mine", abroad: { bogus: 1 } } });
    expect([slug.status, fieldPaths(slug).sort()]).toEqual([422, ["abroad.bogus", "slug"]]);
    expect(await prisma.college.count()).toBe(0);
  });

  test("same name twice gets a distinct address; the name+place decides it", async () => {
    const h = await as();
    const a = await createAbroad(h, { name: "International Medical School" });
    const b = await createAbroad(h, { name: "International Medical School" });
    const c3 = await createAbroad(h, { name: "International Medical School" });
    const k = await createAbroad(h, { name: "International Medical School", countryId: (await country("kazakhstan")).id });
    expect(a.slug).toBe("international-medical-school");
    expect(b.slug).toBe("international-medical-school-russia");
    expect(c3.slug).toBe("international-medical-school-russia-2");
    expect(k.slug).toBe("international-medical-school-kazakhstan");
  });

  test("India college takes a state; the wrong kind of detail is refused with the field named", async () => {
    const h = await as();
    const mh = await state("MH");
    const ru = await country();
    const ok = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "INDIA", name: "Pune Sample College", city: "Pune", stateId: mh.id, india: { mbbsSeats: 150 } } });
    expect(ok.status).toBe(201);
    expect(college(ok)).toMatchObject({ kind: "INDIA", slug: "pune-sample-college", state: { code: "MH" }, country: null, abroad: null, india: { mbbsSeats: 150, nmcRecognised: null } });

    const bad1 = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "INDIA", name: "A", city: "B", countryId: ru.id } });
    expect([bad1.status, fieldPaths(bad1)]).toEqual([422, ["countryId"]]);
    const bad2 = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "A", city: "B", stateId: mh.id, india: {} } });
    expect([bad2.status, fieldPaths(bad2).sort()]).toEqual([422, ["india", "stateId"]]);
    const bad3 = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "A", city: "B", countryId: "0198a000-0000-7000-8000-000000000000" } });
    expect([bad3.status, fieldPaths(bad3)]).toEqual([422, ["countryId"]]);
    const bad4 = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name: "   ", city: "B" } });
    expect([bad4.status, fieldPaths(bad4)]).toEqual([422, ["name"]]);
  });
});

describe("update", () => {
  test("edits details and kind-specific facts; intake months are sorted and de-duplicated; null clears", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const r = await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: { ...abroadDetails, shortName: "KSU", websiteUrl: "https://example.com", internalNotes: "note" } });
    expect(college(r)).toMatchObject({ ownership: "GOVERNMENT", courseLengthMonths: 72, shortName: "KSU", websiteUrl: "https://example.com/", internalNotes: "note", slug: "kazan-sample-university" });
    expect(college(r).abroad).toMatchObject({ wdomsListed: "LISTED", intakeMonths: [2, 9], meetsNmc2021: "MEETS" });

    const cleared = await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: { shortName: null, abroad: { nmcInternshipOk: false, eligibility: { Age: "17 by 31 December" } } } });
    expect(college(cleared)).toMatchObject({ shortName: null });
    expect(college(cleared).abroad).toMatchObject({ meetsNmc2021: "DOES_NOT_MEET", eligibility: { Age: "17 by 31 December" } });
    const noElig = await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: { abroad: { eligibility: null } } });
    expect(college(noElig).abroad.eligibility).toBeNull();
    expect(await auditCount("college.update", c.id)).toBe(3);
  });

  test("refuses: nothing to change, slug/kind/status, wrong-kind details, future check dates, bad urls, unknown rows", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const patch = (json: unknown) => call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ slug: "x" })).status).toBe(422);
    expect((await patch({ kind: "INDIA" })).status).toBe(422);
    expect((await patch({ status: "READY" })).status).toBe(422);
    expect(fieldPaths(await patch({ india: { mbbsSeats: 5 } }))).toEqual(["india"]);
    expect(fieldPaths(await patch({ stateId: (await state()).id }))).toEqual(["stateId"]);
    expect(fieldPaths(await patch({ abroad: { wdomsCheckedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() } }))).toEqual(["abroad.wdomsCheckedAt"]);
    expect(fieldPaths(await patch({ websiteUrl: "javascript:alert(1)" })).length).toBeGreaterThan(0);
    expect((await patch({ courseLengthMonths: 5 })).status).toBe(422);
    expect((await call("/admin/colleges/0198a000-0000-7000-8000-000000000000", { method: "PATCH", headers: h, json: { city: "X" } })).status).toBe(404);
    expect((await call("/admin/colleges/not-a-uuid", { headers: h })).status).toBe(422);
  });
});

describe("Mark ready: nothing incomplete goes live", () => {
  test("a fresh draft is refused with the full list of what is missing, and stays a draft", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const r = await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h });
    expect(r.status).toBe(422);
    expect((r.body as any).error.message).toContain("cannot go live yet");
    expect(fieldPaths(r)).toEqual([
      "ownership", "description", "courseLengthMonths", "abroad.wdomsListed", "abroad.wdomsCheckedAt", "abroad.teachingLanguage", "abroad.intakeMonths",
      "abroad.nmcLengthOk", "abroad.nmcEnglishOk", "abroad.nmcInternshipOk", "abroad.nmcCheckedAt", "sources", "fees",
    ]);
    const after = await call(`/admin/colleges/${c.id}`, { headers: h });
    expect(college(after)).toMatchObject({ status: "DRAFT", readyAt: null });
    expect(college(after).readiness).toMatchObject({ canMarkReady: false, feeYearsRequired: null, feeYearsFilled: 0 });
    expect(college(after).readiness.missing).toHaveLength(13);
    expect(await auditCount("college.ready", c.id)).toBe(0);
  });

  test("no fees = no go, even when everything else is filled", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const src = await newSource(h);
    await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: abroadDetails });
    await call(`/admin/colleges/${c.id}/sources`, { method: "POST", headers: h, json: { sourceId: src, purpose: "WDOMS", checkedAt: daysAgo(1) } });
    const r = await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h });
    expect(r.status).toBe(422);
    expect(fieldPaths(r)).toEqual(["fees"]);
  });

  test("partial fees, a fee without a source, and a currency with no exchange rate each block it, with specific messages", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const src = await newSource(h);
    await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: abroadDetails });
    await call(`/admin/colleges/${c.id}/sources`, { method: "POST", headers: h, json: { sourceId: src, purpose: "WDOMS", checkedAt: daysAgo(1) } });
    for (const y of [1, 2, 3, 4, 5]) await call(`/admin/colleges/${c.id}/fees/${y}`, { method: "PUT", headers: h, json: fee(y === 2 ? null : src) });

    const r = await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h });
    expect(r.status).toBe(422);
    const msgs = Object.fromEntries(((r.body as any).error.fields as any[]).map((f) => [f.path, f.message]));
    expect(msgs["fees"]).toBe("Fees are missing for year 6 (the course has 6 years).");
    expect(msgs["fees.2.sourceId"]).toContain("Year 2 fees have no source");
    expect(msgs["fees.1.currency"]).toContain("no USD exchange rate");

    await addRate("USD");
    await call(`/admin/colleges/${c.id}/fees/2`, { method: "PUT", headers: h, json: fee(src) });
    await call(`/admin/colleges/${c.id}/fees/6`, { method: "PUT", headers: h, json: fee(src) });
    expect((await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h })).status).toBe(200);
  });

  test("a complete college goes live: status, date, rupee total and audit; doing it again changes nothing", async () => {
    const h = await as();
    const { id, college: c } = await readyAbroad(h);
    expect(c).toMatchObject({ status: "READY", totalCourseFeeInr: 6 * Math.round(6500 * 88.5) });
    expect(c.readyAt).not.toBeNull();
    expect(c.readiness).toMatchObject({ canMarkReady: true, missing: [], feeYearsRequired: 6, feeYearsFilled: 6 });
    expect(await auditCount("college.ready", id)).toBe(1);
    const again = await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h });
    expect(college(again).readyAt).toBe(c.readyAt);
    expect(await auditCount("college.ready", id)).toBe(1);
  });

  test("an India college goes live too, with INR fees and no exchange rate needed", async () => {
    const h = await as();
    const mh = await state("MH");
    const src = await newSource(h);
    const created = await call("/admin/colleges", {
      method: "POST", headers: h,
      json: {
        kind: "INDIA", name: "Pune Sample College", city: "Pune", stateId: mh.id, ownership: "PRIVATE", description: "Text.", courseLengthMonths: 66,
        india: { nmcRecognised: true, nmcRecognitionCheckedAt: daysAgo(5), mbbsSeats: 150, hospitalName: "Sample Hospital" },
      },
    });
    const id = college(created).id;
    for (let y = 1; y <= 6; y++) await call(`/admin/colleges/${id}/fees/${y}`, { method: "PUT", headers: h, json: fee(src, { currency: "inr", tuition: 100000, hostel: 0, other: 0 }) });
    await call(`/admin/colleges/${id}/sources`, { method: "POST", headers: h, json: { sourceId: src, purpose: "NMC_RECOGNITION", checkedAt: daysAgo(1) } });
    const r = await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h });
    expect(r.status).toBe(200);
    expect(college(r)).toMatchObject({ status: "READY", totalCourseFeeInr: 600000 });
    expect(college(r).fees[0]).toMatchObject({ currency: "INR", rateToInr: 1, totalInr: 100000 });
  });

  test("an archived college cannot be marked ready directly", async () => {
    const h = await as();
    const { id } = await readyAbroad(h);
    await call(`/admin/colleges/${id}/archive`, { method: "POST", headers: h });
    const r = await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h });
    expect(r.status).toBe(409);
    await call(`/admin/colleges/${id}/draft`, { method: "POST", headers: h });
    expect((await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h })).status).toBe(200);
  });
});

describe("a live college can never be edited into an incomplete state", () => {
  test("clearing a required field, deleting a fee year or the last source is refused and nothing is saved", async () => {
    const h = await as();
    const { id, src } = await readyAbroad(h);
    const before = college(await call(`/admin/colleges/${id}`, { headers: h }));

    const clear = await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { description: null } });
    expect([clear.status, fieldPaths(clear)]).toEqual([422, ["description"]]);
    const clearLang = await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { abroad: { teachingLanguage: null, intakeMonths: [] } } });
    expect(fieldPaths(clearLang).sort()).toEqual(["abroad.intakeMonths", "abroad.teachingLanguage"]);
    const delFee = await call(`/admin/colleges/${id}/fees/3`, { method: "DELETE", headers: h });
    expect([delFee.status, fieldPaths(delFee)]).toEqual([422, ["fees"]]);
    const noSource = await call(`/admin/colleges/${id}/fees/3`, { method: "PUT", headers: h, json: fee(null) });
    expect([noSource.status, fieldPaths(noSource)]).toEqual([422, ["fees.3.sourceId"]]);
    const link = before.sources[0];
    const unlink = await call(`/admin/colleges/${id}/sources/${link.id}`, { method: "DELETE", headers: h });
    expect([unlink.status, fieldPaths(unlink)]).toEqual([422, ["sources"]]);
    const shorter = await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { courseLengthMonths: 60 } });
    expect([shorter.status, fieldPaths(shorter)]).toEqual([422, ["fees"]]); // year 6 is now beyond the course

    const after = college(await call(`/admin/colleges/${id}`, { headers: h }));
    expect(after).toEqual(before); // rolled back completely, including the rupee total
    expect(after.status).toBe("READY");
    expect(src).toBeTruthy();
  });

  test("harmless edits are fine, and the same edits are allowed on a draft", async () => {
    const h = await as();
    const { id, src } = await readyAbroad(h);
    const ok = await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { description: "New text.", shortName: "KSU" } });
    expect(ok.status).toBe(200);
    const fees = await call(`/admin/colleges/${id}/fees/2`, { method: "PUT", headers: h, json: fee(src, { tuition: 6000 }) });
    expect(fees.status).toBe(200);
    await call(`/admin/colleges/${id}/draft`, { method: "POST", headers: h });
    expect((await call(`/admin/colleges/${id}`, { method: "PATCH", headers: h, json: { description: null } })).status).toBe(200);
  });
});

describe("fee table (inline editing)", () => {
  test("rows are created and replaced by year; amounts, currency case, converted totals and the college total follow", async () => {
    const h = await as();
    await addRate("USD", 88.5);
    await addRate("RUB", 0.95);
    const c = await createAbroad(h, { courseLengthMonths: 12 }); // a 1-year course: total exists after one row
    const src = await newSource(h);
    const put = (y: number, json: unknown) => call(`/admin/colleges/${c.id}/fees/${y}`, { method: "PUT", headers: h, json });

    const first = college(await put(1, { tuition: 4000.5, hostel: 800, other: 200, currency: "usd", sourceId: src }));
    expect(first.fees).toHaveLength(1);
    expect(first.fees[0]).toMatchObject({ yearNumber: 1, tuition: 4000.5, hostel: 800, other: 200, currency: "USD", totalLocal: 5000.5, rateToInr: 88.5, totalInr: Math.round(5000.5 * 88.5), source: { id: src } });
    expect(first.totalCourseFeeInr).toBe(Math.round(5000.5 * 88.5));
    expect(first.fees[0].checkedAt).not.toBeNull();

    const replaced = college(await put(1, { tuition: 300000, currency: "RUB", sourceId: src })); // hostel/other default to 0
    expect(replaced.fees).toHaveLength(1);
    expect(replaced.fees[0]).toMatchObject({ hostel: 0, other: 0, currency: "RUB", totalInr: 285000 });
    expect(replaced.totalCourseFeeInr).toBe(285000);
    expect(await auditCount("college.fee_create", c.id)).toBe(1);
    expect(await auditCount("college.fee_update", c.id)).toBe(1);

    const removed = await call(`/admin/colleges/${c.id}/fees/1`, { method: "DELETE", headers: h });
    expect(college(removed)).toMatchObject({ fees: [], totalCourseFeeInr: null });
    expect((await call(`/admin/colleges/${c.id}/fees/1`, { method: "DELETE", headers: h })).status).toBe(404);
  });

  test("the total stays empty until every year has a fee row and every currency has a rate", async () => {
    const h = await as();
    await addRate("USD");
    const c = await createAbroad(h, { courseLengthMonths: 24 });
    const src = await newSource(h);
    const one = college(await call(`/admin/colleges/${c.id}/fees/1`, { method: "PUT", headers: h, json: fee(src) }));
    expect(one.totalCourseFeeInr).toBeNull();
    const noRate = college(await call(`/admin/colleges/${c.id}/fees/2`, { method: "PUT", headers: h, json: fee(src, { currency: "EUR" }) }));
    expect(noRate.totalCourseFeeInr).toBeNull();
    expect(noRate.fees[1]).toMatchObject({ rateToInr: null, totalInr: null });
    const fixed = college(await call(`/admin/colleges/${c.id}/fees/2`, { method: "PUT", headers: h, json: fee(src) }));
    expect(fixed.totalCourseFeeInr).toBe(2 * Math.round(6500 * 88.5));
  });

  test("validation: year range and course length, at most 2 decimals, no negatives, 3-letter currency, real source", async () => {
    const h = await as();
    const c = await createAbroad(h, { courseLengthMonths: 72 });
    const src = await newSource(h);
    const put = (y: number | string, json: unknown) => call(`/admin/colleges/${c.id}/fees/${y}`, { method: "PUT", headers: h, json });
    expect(fieldPaths(await put(7, fee(src)))).toEqual(["year"]);
    expect((await put(13, fee(src))).status).toBe(422);
    expect((await put(0, fee(src))).status).toBe(422);
    expect(fieldPaths(await put(1, fee(src, { tuition: 10.123 })))).toEqual(["tuition"]);
    expect((await put(1, fee(src, { tuition: -5 }))).status).toBe(422);
    expect((await put(1, fee(src, { currency: "US" }))).status).toBe(422);
    expect((await put(1, fee(src, { currency: "US1" }))).status).toBe(422);
    expect(fieldPaths(await put(1, fee("0198a000-0000-7000-8000-000000000000")))).toEqual(["sourceId"]);
    expect(fieldPaths(await put(1, fee(src, { checkedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })))).toEqual(["checkedAt"]);
    expect((await put(1, { currency: "USD", sourceId: src })).status).toBe(422); // tuition is required
    expect((await put(1, fee(src, { tuition: 0 }))).status).toBe(200); // a free year is a real answer
    expect((await call("/admin/colleges/0198a000-0000-7000-8000-000000000000/fees/1", { method: "PUT", headers: h, json: fee(src) })).status).toBe(404);
    expect(await prisma.collegeFeeLine.count()).toBe(1);
  });

  test("changing the course length re-evaluates the total", async () => {
    const h = await as();
    await addRate();
    const c = await createAbroad(h, { courseLengthMonths: 12 });
    const src = await newSource(h);
    expect(college(await call(`/admin/colleges/${c.id}/fees/1`, { method: "PUT", headers: h, json: fee(src) })).totalCourseFeeInr).toBe(Math.round(6500 * 88.5));
    expect(college(await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: { courseLengthMonths: 24 } })).totalCourseFeeInr).toBeNull();
    expect(college(await call(`/admin/colleges/${c.id}`, { method: "PATCH", headers: h, json: { courseLengthMonths: 12 } })).totalCourseFeeInr).toBe(Math.round(6500 * 88.5));
  });
});

describe("status changes and deletion", () => {
  test("draft / archive / back to draft clear or keep the live date correctly, each audited", async () => {
    const h = await as();
    const { id } = await readyAbroad(h);
    const toDraft = college(await call(`/admin/colleges/${id}/draft`, { method: "POST", headers: h }));
    expect(toDraft).toMatchObject({ status: "DRAFT", readyAt: null });
    expect((await call(`/admin/colleges/${id}/draft`, { method: "POST", headers: h })).status).toBe(200); // no-op
    const re = college(await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h }));
    expect(re.status).toBe("READY");
    const arch = college(await call(`/admin/colleges/${id}/archive`, { method: "POST", headers: h }));
    expect(arch).toMatchObject({ status: "ARCHIVED", readyAt: null });
    expect(await auditCount("college.draft", id)).toBe(1);
    expect(await auditCount("college.archive", id)).toBe(1);
  });

  test("only a draft can be deleted; a live or archived college must be archived instead", async () => {
    const h = await as();
    const draft = await createAbroad(h, { name: "Draft One" });
    const { id: live } = await readyAbroad(h, { name: "Live One" });
    expect((await call(`/admin/colleges/${live}`, { method: "DELETE", headers: h })).status).toBe(409);
    await call(`/admin/colleges/${live}/archive`, { method: "POST", headers: h });
    expect((await call(`/admin/colleges/${live}`, { method: "DELETE", headers: h })).status).toBe(409);
    expect((await call(`/admin/colleges/${draft.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await call(`/admin/colleges/${draft.id}`, { headers: h })).status).toBe(404);
    expect(await auditCount("college.delete", draft.id)).toBe(1);
    expect(await prisma.college.count()).toBe(1);
  });
});

describe("source links and FAQs", () => {
  test("link, duplicate refused, re-confirm date, future date refused, unknown source refused, unlink", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const src = await newSource(h);
    const add = (json: unknown) => call(`/admin/colleges/${c.id}/sources`, { method: "POST", headers: h, json });
    const added = await add({ sourceId: src, purpose: "WDOMS", checkedAt: daysAgo(10) });
    expect(added.status).toBe(201);
    const link = college(added).sources[0];
    expect(link).toMatchObject({ purpose: "WDOMS", source: { id: src, title: "Fee notice" } });
    expect((await add({ sourceId: src, purpose: "WDOMS", checkedAt: daysAgo(1) })).status).toBe(409);
    expect((await add({ sourceId: src, purpose: "FEE_NOTICE", checkedAt: daysAgo(1) })).status).toBe(201); // other purpose is fine
    expect(fieldPaths(await add({ sourceId: "0198a000-0000-7000-8000-000000000000", purpose: "OTHER", checkedAt: daysAgo(1) }))).toEqual(["sourceId"]);
    expect(fieldPaths(await add({ sourceId: src, purpose: "OTHER", checkedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }))).toEqual(["checkedAt"]);

    const upd = await call(`/admin/colleges/${c.id}/sources/${link.id}`, { method: "PATCH", headers: h, json: { checkedAt: daysAgo(1) } });
    expect(new Date(college(upd).sources.find((s: any) => s.id === link.id).checkedAt).getTime()).toBeGreaterThan(new Date(link.checkedAt).getTime());
    expect((await call(`/admin/colleges/${c.id}/sources/${link.id}`, { method: "PATCH", headers: h, json: { purpose: "FEE_NOTICE" } })).status).toBe(409);
    expect((await call(`/admin/colleges/${c.id}/sources/${link.id}`, { method: "PATCH", headers: h, json: {} })).status).toBe(422);

    const del = await call(`/admin/colleges/${c.id}/sources/${link.id}`, { method: "DELETE", headers: h });
    expect(college(del).sources).toHaveLength(1);
    expect((await call(`/admin/colleges/${c.id}/sources/${link.id}`, { method: "DELETE", headers: h })).status).toBe(404);
    // A source that a college cites cannot be deleted from the sources list.
    expect((await call(`/admin/sources/${src}`, { method: "DELETE", headers: h })).status).toBe(409);
  });

  test("a source cited by a fee row cannot be deleted either", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const src = await newSource(h);
    await call(`/admin/colleges/${c.id}/fees/1`, { method: "PUT", headers: h, json: fee(src) });
    expect((await call(`/admin/sources/${src}`, { method: "DELETE", headers: h })).status).toBe(409);
  });

  test("FAQs are replaced as a whole, in order, and blank entries are refused", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const put = (items: unknown) => call(`/admin/colleges/${c.id}/faqs`, { method: "PUT", headers: h, json: { items } });
    expect(college(await put([{ question: "Q1", answer: "A1" }, { question: "Q2", answer: "A2" }])).faqs).toEqual([{ question: "Q1", answer: "A1" }, { question: "Q2", answer: "A2" }]);
    expect(college(await put([{ question: "Q2", answer: "A2" }, { question: "Q1", answer: "A1" }])).faqs.map((f: any) => f.question)).toEqual(["Q2", "Q1"]);
    expect(fieldPaths(await put([{ question: "  ", answer: "A" }]))).toEqual(["items.0.question"]);
    expect(college(await put([])).faqs).toEqual([]);
  });
});

describe("list", () => {
  test("A to Z with total, filters, search, cursor paging and a readiness hint per row", async () => {
    const h = await as();
    await readyAbroad(h, { name: "Bravo University" });
    await createAbroad(h, { name: "Alpha University" });
    await createAbroad(h, { name: "Charlie Institute", city: "Ufa", countryId: (await country("kazakhstan")).id });
    await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "INDIA", name: "Delta Medical College", city: "Pune", stateId: (await state()).id } });

    const all = (await call("/admin/colleges", { headers: h })).body as any;
    expect(all.total).toBe(4);
    expect(all.items.map((i: any) => i.name)).toEqual(["Alpha University", "Bravo University", "Charlie Institute", "Delta Medical College"]);
    const bravo = all.items[1];
    expect(bravo).toMatchObject({ status: "READY", readiness: { canMarkReady: true, missingCount: 0, feeYearsRequired: 6, feeYearsFilled: 6 }, totalCourseFeeInr: 6 * Math.round(6500 * 88.5), country: { slug: "russia" } });
    expect(all.items[0].readiness.canMarkReady).toBe(false);
    expect(all.items[0].readiness.missingCount).toBeGreaterThan(5);

    const q = async (qs: string) => ((await call(`/admin/colleges${qs}`, { headers: h })).body as any);
    expect((await q("?kind=INDIA")).items.map((i: any) => i.name)).toEqual(["Delta Medical College"]);
    expect((await q("?status=DRAFT")).total).toBe(3);
    expect((await q("?status=READY")).items).toHaveLength(1);
    expect((await q(`?countryId=${(await country("kazakhstan")).id}`)).items.map((i: any) => i.name)).toEqual(["Charlie Institute"]);
    expect((await q("?q=ufa")).items.map((i: any) => i.name)).toEqual(["Charlie Institute"]);
    expect((await q("?q=UNIVERSITY")).total).toBe(2);
    expect((await q("?q=")).total).toBe(4); // blank = no search

    const p1 = await q("?limit=3");
    expect(p1.items).toHaveLength(3);
    expect(p1.total).toBe(4);
    const p2 = await q(`?limit=3&cursor=${p1.nextCursor}`);
    expect(p2.items.map((i: any) => i.name)).toEqual(["Delta Medical College"]);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("college-level NMC notices", () => {
  test("a notice can now point at a college; mixing country and college is refused; a college with notices cannot be deleted", async () => {
    const h = await as();
    const c = await createAbroad(h);
    const ru = await country();
    const base = { title: "NMC notice", url: "https://nmc.org.in/notice", publishedAt: daysAgo(20), severity: "WARNING", checkedAt: daysAgo(2) };
    const ok = await call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base, scope: "COLLEGE", collegeId: c.id } });
    expect(ok.status).toBe(201);
    expect((ok.body as any).notice).toMatchObject({ scope: "COLLEGE", collegeId: c.id, country: null });

    const both = await call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base, scope: "COLLEGE", collegeId: c.id, countryId: ru.id } });
    expect(fieldPaths(both)).toEqual(["countryId"]);
    const wrong = await call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base, scope: "COUNTRY", countryId: ru.id, collegeId: c.id } });
    expect(fieldPaths(wrong)).toEqual(["collegeId"]);
    const unknown = await call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base, scope: "COLLEGE", collegeId: "0198a000-0000-7000-8000-000000000000" } });
    expect(fieldPaths(unknown)).toEqual(["collegeId"]);

    const list = await call(`/admin/nmc-notices?collegeId=${c.id}`, { headers: h });
    expect((list.body as any).items).toHaveLength(1);
    expect((await call(`/admin/colleges/${c.id}`, { method: "DELETE", headers: h })).status).toBe(409);
  });
});
