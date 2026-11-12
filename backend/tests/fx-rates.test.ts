import { afterAll, beforeEach, describe, expect, test } from "bun:test";
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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const auditCount = (action: string, entityId?: string) => prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });
const fieldPaths = (r: { body: unknown }): string[] => ((r.body as any).error.fields ?? []).map((f: any) => f.path);
const rate = (rateToInr: number, over: Record<string, unknown> = {}) => ({ rateToInr, asOf: today(), ...over });
const put = (h: H, currency: string, json: unknown) => call(`/admin/fx-rates/${currency}`, { method: "PUT", headers: h, json });
const totals = async () => Object.fromEntries((await prisma.college.findMany({ select: { name: true, totalCourseFeeInr: true } })).map((c) => [c.name, c.totalCourseFeeInr]));

async function newSource(h: H) {
  const r = await call("/admin/sources", { method: "POST", headers: h, json: { kind: "COLLEGE_WEBSITE", title: "Fee notice", url: "https://example.com/fees" } });
  return (r.body as any).source.id as string;
}

/** A 1-year college priced in `currency`: tuition 1000 + hostel 200 + other 300 = 1500 in that currency. */
async function collegeIn(h: H, name: string, currency: string, src: string) {
  const ru = await prisma.country.findUniqueOrThrow({ where: { slug: "russia" } });
  const c = await call("/admin/colleges", { method: "POST", headers: h, json: { kind: "ABROAD", name, city: "Kazan", countryId: ru.id, courseLengthMonths: 12 } });
  const id = (c.body as any).college.id as string;
  const r = await call(`/admin/colleges/${id}/fees/1`, { method: "PUT", headers: h, json: { tuition: 1000, hostel: 200, other: 300, currency, sourceId: src } });
  expect(r.status).toBe(200);
  return id;
}

/** Makes a college fully complete (so it can be marked ready); needs a rate for its currency to exist already. */
async function makeLive(h: H, id: string, src: string) {
  await call(`/admin/colleges/${id}`, {
    method: "PATCH", headers: h,
    json: {
      ownership: "GOVERNMENT", description: "Text.",
      abroad: { wdomsListed: "LISTED", wdomsCheckedAt: daysAgo(3), teachingLanguage: "English", intakeMonths: [9], nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: daysAgo(3) },
    },
  });
  await call(`/admin/colleges/${id}/sources`, { method: "POST", headers: h, json: { sourceId: src, purpose: "FEE_NOTICE", checkedAt: daysAgo(1) } });
  const r = await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h });
  expect(r.status).toBe(200);
}

describe("access", () => {
  test("anonymous 401, counsellor 403, write without the CSRF header 403", async () => {
    expect((await call("/admin/fx-rates")).status).toBe(401);
    expect((await call("/admin/fx-rates", { headers: await as("COUNSELLOR") })).status).toBe(403);
    const editor = await as("EDITOR");
    const { "x-bp-admin": _drop, ...readOnly } = editor;
    expect((await put(readOnly, "USD", rate(88.5))).status).toBe(403);
    expect((await call("/admin/fx-rates", { headers: editor })).status).toBe(200);
  });
});

describe("the Exchange rates page (list)", () => {
  test("empty at first; then shows currencies in use that still need a rate, first, with college counts", async () => {
    const h = await as();
    expect((await call("/admin/fx-rates", { headers: h })).body).toEqual({ items: [], missingCount: 0 });

    const src = await newSource(h);
    await collegeIn(h, "A", "USD", src);
    await collegeIn(h, "B", "USD", src);
    await collegeIn(h, "C", "RUB", src);
    await collegeIn(h, "D", "INR", src);
    await put(h, "EUR", rate(95)); // a rate nobody uses yet
    const list = (await call("/admin/fx-rates", { headers: h })).body as any;
    expect(list.missingCount).toBe(2);
    expect(list.items.map((i: any) => [i.currency, i.hasRate, i.collegesUsing])).toEqual([["RUB", false, 1], ["USD", false, 2], ["EUR", true, 0]]); // INR never listed
    expect(list.items[0]).toMatchObject({ rateToInr: null, asOf: null, updatedAt: null, liveCollegesUsing: 0 });
    expect(list.items[2]).toMatchObject({ rateToInr: 95, asOf: today() });

    await put(h, "USD", rate(88.5, { sourceNote: "RBI reference rate" }));
    const after = (await call("/admin/fx-rates", { headers: h })).body as any;
    expect(after.missingCount).toBe(1);
    expect(after.items.map((i: any) => i.currency)).toEqual(["RUB", "EUR", "USD"]);
    expect(after.items.find((i: any) => i.currency === "USD")).toMatchObject({ hasRate: true, rateToInr: 88.5, sourceNote: "RBI reference rate", collegesUsing: 2 });
  });
});

describe("changing a rate updates every INR total", () => {
  test("first rate fills the totals; a new rate re-prices every college using it and nobody else", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    await collegeIn(h, "UsdTwo", "USD", src);
    await collegeIn(h, "RubOne", "RUB", src);
    await collegeIn(h, "InrOne", "INR", src);
    expect(await totals()).toEqual({ UsdOne: null, UsdTwo: null, RubOne: null, InrOne: 1500 });

    const first = await put(h, "usd", rate(88.5));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ rate: { currency: "USD", rateToInr: 88.5, asOf: today() }, collegesUsing: 2, collegesRecalculated: 2 });
    expect(await totals()).toEqual({ UsdOne: 132750, UsdTwo: 132750, RubOne: null, InrOne: 1500 });

    await put(h, "RUB", rate(0.95));
    const changed = await put(h, "USD", rate(90));
    expect(changed.body).toMatchObject({ collegesUsing: 2, collegesRecalculated: 2 });
    expect(await totals()).toEqual({ UsdOne: 135000, UsdTwo: 135000, RubOne: 1425, InrOne: 1500 });

    // The college detail shows the same figure at row level.
    const id = (await prisma.college.findFirstOrThrow({ where: { name: "UsdOne" } })).id;
    const detail = ((await call(`/admin/colleges/${id}`, { headers: h })).body as any).college;
    expect(detail.totalCourseFeeInr).toBe(135000);
    expect(detail.fees[0]).toMatchObject({ rateToInr: 90, totalInr: 135000 });
  });

  test("re-saving an identical rate recalculates nothing; only the date and note move", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    await put(h, "USD", rate(88.5, { asOf: daysAgo(5) }));
    const again = await put(h, "USD", rate(88.5, { sourceNote: "re-checked" }));
    expect(again.body).toMatchObject({ collegesUsing: 0, collegesRecalculated: 0, rate: { asOf: today(), sourceNote: "re-checked" } });
  });

  test("a live college stays live and gets the new price; a missing rate was what kept a draft from going live", async () => {
    const h = await as();
    const src = await newSource(h);
    const id = await collegeIn(h, "Kazan Live", "USD", src);

    // Without a rate the gate says exactly what to do.
    const blocked = await call(`/admin/colleges/${id}/ready`, { method: "POST", headers: h });
    expect(blocked.status).toBe(422);
    const msg = ((blocked.body as any).error.fields as any[]).find((f) => f.path === "fees.1.currency").message;
    expect(msg).toContain("no USD exchange rate");
    expect(msg).toContain("Exchange rates page");

    await put(h, "USD", rate(88.5));
    await makeLive(h, id, src);
    expect((await prisma.college.findUniqueOrThrow({ where: { id } })).status).toBe("READY");

    await put(h, "USD", rate(92));
    const after = await prisma.college.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: "READY", totalCourseFeeInr: 138000 });
  });
});

describe("validation", () => {
  test("INR, bad codes, non-positive or over-precise rates, future dates are refused with the field named", async () => {
    const h = await as();
    expect(fieldPaths(await put(h, "INR", rate(1)))).toEqual(["currency"]);
    expect((await put(h, "US", rate(88))).status).toBe(422);
    expect((await put(h, "US1", rate(88))).status).toBe(422);
    expect((await put(h, "USD", rate(0))).status).toBe(422);
    expect((await put(h, "USD", rate(-3))).status).toBe(422);
    expect((await put(h, "USD", rate(1e9))).status).toBe(422);
    expect(fieldPaths(await put(h, "USD", rate(88.1234567)))).toEqual(["rateToInr"]);
    expect(fieldPaths(await put(h, "USD", rate(88, { asOf: new Date(Date.now() + 5 * 86_400_000).toISOString() })))).toEqual(["asOf"]);
    expect((await put(h, "USD", rate(88, { asOf: "last week" }))).status).toBe(422);
    expect((await put(h, "USD", { rateToInr: 88 })).status).toBe(422); // asOf is required
    expect(await prisma.fxRate.count()).toBe(0);
    expect((await put(h, "USD", rate(0.000001))).status).toBe(200); // the smallest allowed rate
  });
});

describe("large-change safeguard", () => {
  test("a first rate and small moves go through; a jump over 20% needs confirmation", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    expect((await put(h, "USD", rate(88.5))).status).toBe(200); // first rate: nothing to compare with
    expect((await put(h, "USD", rate(100))).status).toBe(200); // +13%
    expect((await put(h, "USD", rate(120))).status).toBe(200); // exactly +20%

    const slip = await put(h, "USD", rate(885));
    expect([slip.status, fieldPaths(slip)]).toEqual([422, ["rateToInr"]]);
    expect(((slip.body as any).error.fields[0].message as string)).toContain("changes the USD rate by 638%");
    expect((await prisma.fxRate.findUniqueOrThrow({ where: { currency: "USD" } })).rateToInr.toString()).toBe("120");
    expect((await totals()).UsdOne).toBe(180000);

    const confirmed = await put(h, "USD", rate(885, { confirmLargeChange: true }));
    expect(confirmed.status).toBe(200);
    expect((await totals()).UsdOne).toBe(1327500);
    const drop = await put(h, "USD", rate(88.5));
    expect(drop.status).toBe(422); // a big drop is guarded too
  });
});

describe("bulk save", () => {
  test("sets several rates together, normalising codes, and re-prices once", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    await collegeIn(h, "RubOne", "RUB", src);
    const r = await call("/admin/fx-rates", {
      method: "PUT", headers: h,
      json: { items: [{ currency: "usd", ...rate(88.5) }, { currency: "RUB", ...rate(0.95), sourceNote: "CBR" }, { currency: "uzs", ...rate(0.007) }] },
    });
    expect(r.status).toBe(200);
    expect((r.body as any).rates.map((x: any) => x.currency)).toEqual(["USD", "RUB", "UZS"]);
    expect(r.body).toMatchObject({ collegesUsing: 2, collegesRecalculated: 2 });
    expect(await totals()).toEqual({ UsdOne: 132750, RubOne: 1425 });
    expect(await prisma.auditLog.count({ where: { action: "fx_rate.set", entityId: { in: ["USD", "RUB", "UZS"] }, actorEmail: { in: emails } } })).toBeGreaterThanOrEqual(3);
    expect((await prisma.auditLog.findMany({ where: { action: "fx_rate.set", entityId: "UZS" } })).length).toBe(1);
  });

  test("all or nothing: one bad row saves nothing and names its row; duplicates and big jumps are caught", async () => {
    const h = await as();
    await put(h, "USD", rate(88.5));
    const bad = await call("/admin/fx-rates", { method: "PUT", headers: h, json: { items: [{ currency: "RUB", ...rate(0.95) }, { currency: "INR", ...rate(1) }, { currency: "EUR", ...rate(95.123456789) }] } });
    expect([bad.status, fieldPaths(bad).sort()]).toEqual([422, ["items.1.currency", "items.2.rateToInr"]]);
    expect(await prisma.fxRate.count()).toBe(1);

    const dup = await call("/admin/fx-rates", { method: "PUT", headers: h, json: { items: [{ currency: "RUB", ...rate(1) }, { currency: "rub", ...rate(2) }] } });
    expect(fieldPaths(dup)).toEqual(["items.1.currency"]);

    const jump = await call("/admin/fx-rates", { method: "PUT", headers: h, json: { items: [{ currency: "EUR", ...rate(95) }, { currency: "USD", ...rate(885) }] } });
    expect(fieldPaths(jump)).toEqual(["items.1.rateToInr"]);
    expect(await prisma.fxRate.count()).toBe(1);
    const ok = await call("/admin/fx-rates", { method: "PUT", headers: h, json: { confirmLargeChange: true, items: [{ currency: "EUR", ...rate(95) }, { currency: "USD", ...rate(885) }] } });
    expect(ok.status).toBe(200);
    expect((await call("/admin/fx-rates", { method: "PUT", headers: h, json: { items: [] } })).status).toBe(422);
  });
});

describe("removing a rate", () => {
  test("draft colleges lose their rupee total until a rate is set again", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    await put(h, "USD", rate(88.5));
    expect((await totals()).UsdOne).toBe(132750);
    const del = await call("/admin/fx-rates/usd", { method: "DELETE", headers: h });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, collegesUsing: 1, collegesRecalculated: 1 });
    expect((await totals()).UsdOne).toBeNull();
    expect(await auditCount("fx_rate.delete", "USD")).toBe(1);
    expect(((await call("/admin/fx-rates", { headers: h })).body as any).missingCount).toBe(1); // back to "needs a rate"
    expect((await call("/admin/fx-rates/USD", { method: "DELETE", headers: h })).status).toBe(404);
  });

  test("refused while a live college prices fees in that currency; nothing changes", async () => {
    const h = await as();
    const src = await newSource(h);
    const id = await collegeIn(h, "Live One", "USD", src);
    await put(h, "USD", rate(88.5));
    await makeLive(h, id, src);

    const del = await call("/admin/fx-rates/USD", { method: "DELETE", headers: h });
    expect(del.status).toBe(409);
    expect((del.body as any).error.message).toContain("1 live college prices its fees in USD");
    expect(await prisma.fxRate.count()).toBe(1);
    expect((await totals())["Live One"]).toBe(132750);

    // Moving it back to draft frees the rate.
    await call(`/admin/colleges/${id}/draft`, { method: "POST", headers: h });
    expect((await call("/admin/fx-rates/USD", { method: "DELETE", headers: h })).status).toBe(200);
  });
});

describe("audit", () => {
  test("each rate change records who, before and after, and how many colleges were re-priced", async () => {
    const h = await as();
    const src = await newSource(h);
    await collegeIn(h, "UsdOne", "USD", src);
    await put(h, "USD", rate(88.5));
    await put(h, "USD", rate(90));
    const rows = (await prisma.auditLog.findMany({ where: { action: "fx_rate.set", entityId: "USD" }, orderBy: { at: "asc" } })).slice(-2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.before).toBeNull();
    expect(rows[1]!.before).toMatchObject({ rateToInr: 88.5 });
    expect(rows[1]!.after).toMatchObject({ rateToInr: 90, collegesPriced: 1, collegesRecalculated: 1 });
  });
});
