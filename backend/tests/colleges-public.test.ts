import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { seedReferenceData } from "../prisma/seed/reference";
import { recalcCourseTotals } from "../src/modules/college/college.service";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs } from "./admin-helpers";

const emails: string[] = [];

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
  await prisma.fxRate.createMany({
    data: [
      { currency: "USD", rateToInr: 88.5, asOf: new Date("2026-10-01") },
      { currency: "RUB", rateToInr: 0.95, asOf: new Date("2026-09-01") },
    ],
  });
});
afterAll(async () => {
  await wipe();
  await cleanup(emails);
});

const D = (s: string) => new Date(s);
const body = (r: { body: unknown }) => r.body as any;
const listPath = (qs = "") => `/colleges${qs}`;
const slugsOf = async (qs = "") => body(await call(listPath(qs))).items.map((i: any) => i.slug) as string[];

let src: { id: string } | undefined;
async function source(): Promise<{ id: string }> {
  if (!src) {
    src = (await prisma.source.findFirst({ where: { title: "Fee notice" } })) ?? (await prisma.source.create({ data: { kind: "COLLEGE_WEBSITE", title: "Fee notice", publisher: "The college", url: "https://example.edu/fees" } }));
  }
  return src;
}
beforeEach(() => { src = undefined; });

interface Make {
  name: string;
  slug?: string;
  kind?: "INDIA" | "ABROAD";
  country?: string;
  state?: string;
  city?: string;
  ownership?: "GOVERNMENT" | "PRIVATE" | "DEEMED" | "TRUST";
  status?: "DRAFT" | "READY" | "ARCHIVED";
  years?: number;
  currency?: string;
  tuition?: number;
  feeChecked?: string;
}

/** A complete college straight in the database (the admin API is covered elsewhere). */
async function make(m: Make) {
  const kind = m.kind ?? "ABROAD";
  const status = m.status ?? "READY";
  const years = m.years ?? 2;
  const s = await source();
  const country = kind === "ABROAD" ? await prisma.country.findUniqueOrThrow({ where: { slug: m.country ?? "russia" } }) : null;
  const state = kind === "INDIA" ? await prisma.state.findUniqueOrThrow({ where: { code: m.state ?? "MH" } }) : null;
  const c = await prisma.college.create({
    data: {
      slug: m.slug ?? m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), kind, name: m.name, city: m.city ?? "Kazan", ownership: m.ownership ?? "GOVERNMENT",
      courseLengthMonths: years * 12, description: `About ${m.name}.`, status, readyAt: status === "READY" ? new Date() : null,
      countryId: country?.id, stateId: state?.id, internalNotes: "STAFF ONLY NOTE", locationBasis: "CHECKED_ONLINE", heroImageUrl: "https://example.edu/hero.jpg",
      ...(kind === "ABROAD"
        ? { abroadProfile: { create: { wdomsListed: "LISTED", wdomsId: "F123", wdomsCheckedAt: D("2026-10-20"), teachingLanguage: "English", languageNote: "Russian from year 3", intakeMonths: [2, 9], internshipMonths: 12, seatsForIndians: 50, nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: D("2026-10-25"), eligibility: { Age: "17 by 31 December" }, documents: ["Passport"] } } }
        : { indiaProfile: { create: { nmcRecognised: true, nmcRecognitionCheckedAt: D("2026-10-22"), mbbsSeats: 150, hospitalName: "Sample Hospital", hospitalBeds: 800, dailyOutpatients: 2500, stipendInr: 25000 } } }),
      feeLines: { create: Array.from({ length: years }, (_, i) => ({ yearNumber: i + 1, tuition: m.tuition ?? 5000, hostel: 1000, other: 500, currency: m.currency ?? (kind === "INDIA" ? "INR" : "USD"), sourceId: s.id, checkedAt: D(m.feeChecked ?? "2026-10-30") })) },
      sourceLinks: { create: [{ sourceId: s.id, purpose: "FEE_NOTICE", checkedAt: D("2026-10-28") }] },
    },
  });
  await recalcCourseTotals(prisma, [c.id]);
  return c;
}

describe("who is visible", () => {
  test("only READY colleges: drafts and archived ones are in neither the list nor the page, and their page is an ordinary 404", async () => {
    await make({ name: "Live One" });
    await make({ name: "Draft One", status: "DRAFT" });
    await make({ name: "Archived One", status: "ARCHIVED" });
    expect(await slugsOf()).toEqual(["live-one"]);
    expect((await call("/colleges/live-one")).status).toBe(200);
    const draft = await call("/colleges/draft-one");
    const nothing = await call("/colleges/no-such-college");
    expect(draft.status).toBe(404);
    expect(body(draft).error.code).toBe("NOT_FOUND");
    expect(body(draft).error.message).toBe(body(nothing).error.message); // a draft's address cannot be told from a missing one
    expect((await call("/colleges/archived-one")).status).toBe(404);
  });

  test("a foreign college is hidden until its country is live; Indian colleges only need to be ready", async () => {
    await make({ name: "Nepal College", country: "nepal" });
    await make({ name: "India College", kind: "INDIA", state: "GA" }); // Goa is not a "live" state, and that does not matter
    expect(await slugsOf()).toEqual(["india-college"]);
    expect((await call("/colleges/nepal-college")).status).toBe(404);
    await prisma.country.update({ where: { slug: "nepal" }, data: { status: "LIVE" } });
    expect(await slugsOf()).toEqual(["india-college", "nepal-college"]);
    expect((await call("/colleges/nepal-college")).status).toBe(200);
    await prisma.country.update({ where: { slug: "nepal" }, data: { status: "COMING_SOON" } });
    expect((await call("/colleges/nepal-college")).status).toBe(404);
  });

  test("end to end with the admin API: marking ready publishes, moving back to draft takes it down at once", async () => {
    const staff = await createStaff("EDITOR");
    emails.push(staff.email);
    const h = await loginAs(staff.email);
    const c = await make({ name: "Admin Flow University", status: "DRAFT" }); // complete, but still a draft
    expect((await call("/colleges/admin-flow-university")).status).toBe(404);
    expect(await slugsOf()).toEqual([]);

    expect((await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h })).status).toBe(200);
    expect((await call("/colleges/admin-flow-university")).status).toBe(200);
    expect(await slugsOf()).toEqual(["admin-flow-university"]);

    expect((await call(`/admin/colleges/${c.id}/draft`, { method: "POST", headers: h })).status).toBe(200);
    expect((await call("/colleges/admin-flow-university")).status).toBe(404);
    expect(await slugsOf()).toEqual([]);

    await call(`/admin/colleges/${c.id}/ready`, { method: "POST", headers: h });
    expect((await call(`/admin/colleges/${c.id}/archive`, { method: "POST", headers: h })).status).toBe(200);
    expect((await call("/colleges/admin-flow-university")).status).toBe(404);
  });
});

describe("what a page shows", () => {
  test("foreign college: fees year by year with rupees, NMC and WDOMS facts, provenance, flight time, FAQs; no staff-only data", async () => {
    await prisma.country.update({ where: { slug: "russia" }, data: { typicalFlightFromDelhi: "about 5 hours" } });
    const c = await make({ name: "Kazan Sample University", feeChecked: "2026-10-30" });
    await prisma.collegeFaq.createMany({ data: [{ collegeId: c.id, question: "Q2", answer: "A2", sort: 1 }, { collegeId: c.id, question: "Q1", answer: "A1", sort: 0 }] });
    await prisma.college.update({ where: { id: c.id }, data: { websiteUrl: "https://kazan.example.edu/", shortName: "KSU", establishedYear: 1804 } });

    const res = await call("/colleges/kazan-sample-university");
    expect(res.status).toBe(200);
    const p = body(res).college;
    expect(p).toMatchObject({
      slug: "kazan-sample-university", kind: "ABROAD", name: "Kazan Sample University", shortName: "KSU", city: "Kazan", ownership: "GOVERNMENT", establishedYear: 1804,
      courseLengthMonths: 24, websiteUrl: "https://kazan.example.edu/", heroImageUrl: "https://example.edu/hero.jpg", india: null,
      country: { slug: "russia", name: "Russia", typicalFlightFromDelhi: "about 5 hours" }, state: null,
    });
    expect(p.fees).toEqual([
      { yearNumber: 1, tuition: 5000, hostel: 1000, other: 500, currency: "USD", totalLocal: 6500, rateToInr: 88.5, totalInr: 575250, source: { title: "Fee notice", url: "https://example.edu/fees" }, checkedAt: "2026-10-30T00:00:00.000Z" },
      { yearNumber: 2, tuition: 5000, hostel: 1000, other: 500, currency: "USD", totalLocal: 6500, rateToInr: 88.5, totalInr: 575250, source: { title: "Fee notice", url: "https://example.edu/fees" }, checkedAt: "2026-10-30T00:00:00.000Z" },
    ]);
    expect(p.totalCourseFeeInr).toBe(1150500);
    expect(p.feeRatesAsOf).toBe("2026-10-01");
    expect(p.abroad).toEqual({
      wdoms: { status: "LISTED", id: "F123", url: null, checkedAt: "2026-10-20T00:00:00.000Z" },
      nmc2021: { status: "MEETS", lengthOk: true, englishOk: true, internshipOk: true, checkedAt: "2026-10-25T00:00:00.000Z" },
      teachingLanguage: "English", languageNote: "Russian from year 3", internshipMonths: 12, intakeMonths: [2, 9], seatsForIndians: 50,
      eligibility: { Age: "17 by 31 December" }, documents: ["Passport"],
    });
    expect(p.sources).toEqual([{ purpose: "FEE_NOTICE", title: "Fee notice", publisher: "The college", url: "https://example.edu/fees", checkedAt: "2026-10-28T00:00:00.000Z" }]);
    expect(p.dataCheckedAt).toBe("2026-10-20T00:00:00.000Z"); // the oldest check (WDOMS), not the newest
    expect(p.nmc).toEqual({ alert: "NONE", notices: [], checkedAt: "2026-10-25T00:00:00.000Z" });
    expect(p.faqs).toEqual([{ question: "Q1", answer: "A1" }, { question: "Q2", answer: "A2" }]);

    // Nothing staff-only or internal leaks, anywhere in the response.
    for (const secret of ["STAFF ONLY NOTE", "internalNotes", "locationBasis", "importBatch", "readyAt", "createdAt", '"status":"READY"', '"status":"DRAFT"', c.id]) expect(res.text).not.toContain(secret);
  });

  test("Indian college: its own block, hospital, stipend, a bond only when there is one, rupees as entered", async () => {
    const c = await make({ name: "Pune Sample College", kind: "INDIA", city: "Pune", ownership: "PRIVATE", years: 6, tuition: 100000 });
    const p = body(await call("/colleges/pune-sample-college")).college;
    expect(p).toMatchObject({ kind: "INDIA", abroad: null, country: null, state: { slug: "maharashtra", name: "Maharashtra", code: "MH" }, feeRatesAsOf: null, ownership: "PRIVATE" });
    expect(p.india).toEqual({
      nmcRecognised: true, nmcRecognitionCheckedAt: "2026-10-22T00:00:00.000Z", mbbsSeats: 150, hospital: { name: "Sample Hospital", beds: 800, dailyOutpatients: 2500 },
      serviceBond: null, stipendInr: 25000, domicileRule: null,
    });
    expect(p.fees[0]).toMatchObject({ currency: "INR", rateToInr: 1, totalInr: 101500 });
    expect(p.totalCourseFeeInr).toBe(6 * 101500);
    expect(p.nmc.checkedAt).toBe("2026-10-22T00:00:00.000Z");

    await prisma.collegeIndiaProfile.update({ where: { collegeId: c.id }, data: { serviceBondYears: 2, serviceBondPenaltyInr: 1000000 } });
    expect(body(await call("/colleges/pune-sample-college")).college.india.serviceBond).toEqual({ years: 2, penaltyInr: 1000000 });
    await prisma.collegeIndiaProfile.update({ where: { collegeId: c.id }, data: { serviceBondYears: 0 } });
    expect(body(await call("/colleges/pune-sample-college")).college.india.serviceBond).toBeNull();
  });

  test("the slug is case-insensitive and anything that is not a web-address part is refused", async () => {
    await make({ name: "Kazan Sample University" });
    expect((await call("/colleges/KAZAN-Sample-University")).status).toBe(200);
    expect((await call("/colleges/bad_slug!")).status).toBe(422);
  });

  test("changing an exchange rate changes the page and the total, and the rate date follows the oldest rate used", async () => {
    await make({ name: "Mixed Fees University", years: 2 });
    await prisma.collegeFeeLine.update({ where: { collegeId_yearNumber: { collegeId: (await prisma.college.findFirstOrThrow()).id, yearNumber: 2 } }, data: { currency: "RUB", tuition: 400000, hostel: 0, other: 0 } });
    await recalcCourseTotals(prisma);
    const p = body(await call("/colleges/mixed-fees-university")).college;
    expect(p.feeRatesAsOf).toBe("2026-09-01"); // RUB is the older rate
    expect(p.totalCourseFeeInr).toBe(575250 + 380000);

    await prisma.fxRate.update({ where: { currency: "RUB" }, data: { rateToInr: 1, asOf: D("2026-11-10") } });
    await recalcCourseTotals(prisma);
    const q = body(await call("/colleges/mixed-fees-university")).college;
    expect(q.feeRatesAsOf).toBe("2026-10-01");
    expect(q.totalCourseFeeInr).toBe(575250 + 400000);
  });
});

describe("NMC alerts", () => {
  const notice = (over: Record<string, unknown>) => ({ title: "NMC notice", url: "https://nmc.org.in/n", publishedAt: D("2026-09-01"), severity: "WARNING" as const, scope: "COLLEGE" as const, checkedAt: D("2026-11-01"), isActive: true, ...over });

  test("a country notice raises the alert on every college there; a college notice only on that college; the highest severity wins", async () => {
    const a = await make({ name: "Alpha University" });
    await make({ name: "Beta University" });
    await make({ name: "Gamma College", country: "kazakhstan" });
    const ru = await prisma.country.findUniqueOrThrow({ where: { slug: "russia" } });
    await prisma.nmcNotice.create({ data: notice({ scope: "COUNTRY", countryId: ru.id, severity: "ADVISORY", title: "Russia advisory" }) });
    await prisma.nmcNotice.create({ data: notice({ scope: "COLLEGE", collegeId: a.id, severity: "WARNING", title: "Alpha warning", publishedAt: D("2026-10-01") }) });
    await prisma.country.update({ where: { slug: "kazakhstan" }, data: { status: "LIVE" } });

    const alert = Object.fromEntries(body(await call("/colleges")).items.map((i: any) => [i.slug, i.badges.nmcAlert]));
    expect(alert).toEqual({ "alpha-university": "WARNING", "beta-university": "ADVISORY", "gamma-college": "NONE" });
    const page = body(await call("/colleges/alpha-university")).college;
    expect(page.nmc.alert).toBe("WARNING");
    expect(page.nmc.notices.map((n: any) => [n.title, n.scope])).toEqual([["Alpha warning", "COLLEGE"], ["Russia advisory", "COUNTRY"]]); // newest first
  });

  test("an inactive notice does not count", async () => {
    const a = await make({ name: "Alpha University" });
    await prisma.nmcNotice.create({ data: notice({ collegeId: a.id, isActive: false }) });
    expect(body(await call("/colleges/alpha-university")).college.nmc).toMatchObject({ alert: "NONE", notices: [] });
  });
});

describe("the list", () => {
  async function fixture() {
    await make({ name: "Alpha University", city: "Kazan", ownership: "GOVERNMENT", tuition: 5000 }); // 2 x 6,500 USD = 1,150,500
    await make({ name: "Beta Institute", city: "Ufa", ownership: "PRIVATE", tuition: 3000, years: 2 }); // 2 x 4,500 = 796,500
    await make({ name: "Gamma College", country: "kazakhstan", city: "Almaty", ownership: "GOVERNMENT", tuition: 8000 }); // 2 x 9,500 = 1,681,500
    await make({ name: "Delta Medical College", kind: "INDIA", city: "Pune", ownership: "PRIVATE", years: 6, tuition: 100000 }); // 609,000
    await make({ name: "Epsilon Medical College", kind: "INDIA", state: "GA", city: "Panaji", ownership: "GOVERNMENT", years: 6, tuition: 5000 }); // 6 x 6,500 INR
    await prisma.country.update({ where: { slug: "kazakhstan" }, data: { status: "LIVE" } });
  }

  test("A to Z by default with the card chips, rupee fee and a total; hidden ones never count", async () => {
    await fixture();
    await make({ name: "Hidden Draft", status: "DRAFT" });
    const r = body(await call("/colleges"));
    expect(r).toMatchObject({ total: 5, page: 1, pageSize: 24, totalPages: 1 });
    expect(r.items.map((i: any) => i.name)).toEqual(["Alpha University", "Beta Institute", "Delta Medical College", "Epsilon Medical College", "Gamma College"]);
    expect(r.items[0]).toMatchObject({
      slug: "alpha-university", kind: "ABROAD", city: "Kazan", country: { slug: "russia", name: "Russia" }, state: null, totalCourseFeeInr: 1150500,
      badges: { nmcAlert: "NONE", nmcRecognised: null, wdomsListed: "LISTED", meetsNmc2021: "MEETS" },
      dataCheckedAt: "2026-10-20T00:00:00.000Z",
    });
    expect(r.items[2]).toMatchObject({ kind: "INDIA", state: { code: "MH" }, country: null, badges: { nmcRecognised: true, wdomsListed: null, meetsNmc2021: null } });
  });

  test("filters: kind, country, state, ownership, text, budget, and combinations", async () => {
    await fixture();
    expect(await slugsOf("?kind=INDIA")).toEqual(["delta-medical-college", "epsilon-medical-college"]);
    expect(await slugsOf("?kind=ABROAD")).toEqual(["alpha-university", "beta-institute", "gamma-college"]);
    expect(await slugsOf("?country=russia")).toEqual(["alpha-university", "beta-institute"]);
    expect(await slugsOf("?country=RUSSIA")).toEqual(["alpha-university", "beta-institute"]);
    expect(await slugsOf("?state=goa")).toEqual(["epsilon-medical-college"]);
    expect(await slugsOf("?ownership=PRIVATE")).toEqual(["beta-institute", "delta-medical-college"]);
    expect(await slugsOf("?q=medical")).toEqual(["delta-medical-college", "epsilon-medical-college"]);
    expect(await slugsOf("?q=UFA")).toEqual(["beta-institute"]); // city
    expect(await slugsOf("?q=")).toHaveLength(5); // blank = no search
    expect(await slugsOf("?maxFeeInr=800000")).toEqual(["beta-institute", "delta-medical-college", "epsilon-medical-college"]);
    expect(await slugsOf("?minFeeInr=1000000&maxFeeInr=1200000")).toEqual(["alpha-university"]);
    expect(await slugsOf("?kind=ABROAD&maxFeeInr=1200000&ownership=GOVERNMENT")).toEqual(["alpha-university"]);
    expect(await slugsOf("?country=atlantis")).toEqual([]);
  });

  test("sorting by fee, cheapest or dearest first, ties by name", async () => {
    await fixture();
    expect(await slugsOf("?sort=fee_asc")).toEqual(["epsilon-medical-college", "delta-medical-college", "beta-institute", "alpha-university", "gamma-college"]);
    expect(await slugsOf("?sort=fee_desc")).toEqual(["gamma-college", "alpha-university", "beta-institute", "delta-medical-college", "epsilon-medical-college"]);
    expect(await slugsOf("?sort=name")).toEqual(["alpha-university", "beta-institute", "delta-medical-college", "epsilon-medical-college", "gamma-college"]);
  });

  test("paging gives stable, non-overlapping pages; beyond the end is an empty page, not an error", async () => {
    await fixture();
    const p1 = body(await call("/colleges?pageSize=2&page=1"));
    const p2 = body(await call("/colleges?pageSize=2&page=2"));
    const p3 = body(await call("/colleges?pageSize=2&page=3"));
    expect([p1.totalPages, p1.total]).toEqual([3, 5]);
    expect([...p1.items, ...p2.items, ...p3.items].map((i: any) => i.slug)).toEqual(await slugsOf());
    expect(p3.items).toHaveLength(1);
    const beyond = body(await call("/colleges?pageSize=2&page=9"));
    expect([beyond.items, beyond.total, beyond.page]).toEqual([[], 5, 9]);
  });

  test("filter options with counts cover every listed college and do not shrink with the current filters", async () => {
    await fixture();
    const f = body(await call("/colleges?country=russia&maxFeeInr=800000")).facets;
    expect(f.countries).toEqual([{ slug: "russia", name: "Russia", count: 2 }, { slug: "kazakhstan", name: "Kazakhstan", count: 1 }]);
    expect(f.states).toEqual([{ slug: "goa", name: "Goa", code: "GA", count: 1 }, { slug: "maharashtra", name: "Maharashtra", code: "MH", count: 1 }]);
    expect(f.ownership).toEqual([{ value: "GOVERNMENT", count: 3 }, { value: "PRIVATE", count: 2 }]);
    expect(f.totalFeeInr).toEqual({ min: 39000, max: 1681500 });
  });

  test("an empty catalogue is a valid, empty answer", async () => {
    const r = body(await call("/colleges"));
    expect(r).toMatchObject({ items: [], total: 0, totalPages: 1, facets: { countries: [], states: [], ownership: [], totalFeeInr: { min: null, max: null } } });
  });

  test("bad parameters are refused with the field named", async () => {
    for (const qs of ["?pageSize=51", "?pageSize=0", "?page=0", "?sort=cheapest", "?kind=MARS", "?ownership=FREE", "?maxFeeInr=-1", "?maxFeeInr=abc"]) {
      const r = await call(`/colleges${qs}`);
      expect([qs, r.status]).toEqual([qs, 422]);
      expect(body(r).error.fields[0].path).toBe(qs.slice(1).split("=")[0]);
    }
  });
});

describe("nearby colleges", () => {
  test("up to 4 other listed colleges: same city first, then the rest of the country; never itself, drafts or other kinds", async () => {
    await make({ name: "Main University", city: "Kazan" });
    await make({ name: "A Far College", city: "Ufa" });
    await make({ name: "B Far College", city: "Ufa" });
    await make({ name: "C Far College", city: "Ufa" });
    await make({ name: "Z Same City College", city: "Kazan" });
    await make({ name: "Hidden Draft", city: "Kazan", status: "DRAFT" });
    await make({ name: "India One", kind: "INDIA", city: "Kazan" });
    const nearby = body(await call("/colleges/main-university")).college.nearby;
    expect(nearby.map((n: any) => n.name)).toEqual(["Z Same City College", "A Far College", "B Far College", "C Far College"]);
    expect(nearby[0]).toHaveProperty("badges");
    const lone = await make({ name: "Lonely College", country: "georgia", city: "Tbilisi" });
    expect(body(await call(`/colleges/${lone.slug}`)).college.nearby).toEqual([]);
  });
});

describe("caching", () => {
  test("pages and lists carry an ETag; sending it back answers 304; a change gives a new tag", async () => {
    const c = await make({ name: "Cache University" });
    for (const path of ["/colleges", "/colleges/cache-university"]) {
      const first = await call(path);
      const tag = first.headers.get("etag")!;
      expect(tag).toStartWith('W/"');
      expect(first.headers.get("cache-control")).toContain("max-age=60");
      const again = await call(path, { headers: { "if-none-match": tag } });
      expect(again.status).toBe(304);
    }
    const tag = (await call("/colleges/cache-university")).headers.get("etag");
    await prisma.college.update({ where: { id: c.id }, data: { description: "Changed." } });
    const next = await call("/colleges/cache-university");
    expect(next.headers.get("etag")).not.toBe(tag);
    expect(body(next).college.description).toBe("Changed.");
  });
});
