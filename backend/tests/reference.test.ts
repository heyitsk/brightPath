import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { seedReferenceData } from "../prisma/seed/reference";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs, WRITE } from "./admin-helpers";

const emails: string[] = [];

async function wipe() {
  await prisma.nmcNotice.deleteMany();
  await prisma.country.deleteMany();
  await prisma.state.deleteMany();
  await prisma.source.deleteMany();
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
const auditCount = (action: string, entityId?: string) => prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });

async function newCountry(h: Record<string, string>, over: Record<string, unknown> = {}) {
  const res = await call("/admin/countries", { method: "POST", headers: h, json: { slug: "russia", name: "Russia", isoCode: "RU", ...over } });
  expect(res.status).toBe(201);
  return (res.body as any).country as { id: string; slug: string };
}

describe("access control", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/admin/states"],
    ["GET", "/admin/countries"],
    ["GET", "/admin/sources"],
    ["GET", "/admin/nmc-notices"],
  ];

  test("anonymous callers get 401 everywhere", async () => {
    for (const [method, path] of routes) expect((await call(path, { method })).status).toBe(401);
  });

  test("COUNSELLOR is refused, EDITOR and ADMIN are allowed", async () => {
    const counsellor = await as("COUNSELLOR");
    const editor = await as("EDITOR");
    const admin = await as("ADMIN");
    for (const [method, path] of routes) {
      expect((await call(path, { method, headers: counsellor })).status).toBe(403);
      expect((await call(path, { method, headers: editor })).status).toBe(200);
      expect((await call(path, { method, headers: admin })).status).toBe(200);
    }
  });

  test("a write without the X-BP-Admin header is refused", async () => {
    const h = await as("EDITOR");
    const { "x-bp-admin": _drop, ...noCsrf } = h;
    const res = await call("/admin/states", { method: "POST", headers: noCsrf, json: { slug: "goa", name: "Goa", code: "GA" } });
    expect(res.status).toBe(403);
    expect(await prisma.state.count()).toBe(0);
  });
});

describe("states", () => {
  test("create, read, list; slug is fixed, aliases are normalised, change is audited", async () => {
    const h = await as("EDITOR");
    const created = await call("/admin/states", {
      method: "POST",
      headers: h,
      json: { slug: "uttar-pradesh", name: "  Uttar Pradesh ", code: "UP", aliases: [" UP ", "up", "U.P."] },
    });
    expect(created.status).toBe(201);
    const s = (created.body as any).state;
    expect(s).toMatchObject({ slug: "uttar-pradesh", name: "Uttar Pradesh", code: "UP", isLive: false, sortOrder: 1000, aliases: ["u.p.", "up"] });
    expect(await auditCount("state.create", s.id)).toBe(1);

    const patched = await call(`/admin/states/${s.id}`, { method: "PATCH", headers: h, json: { isLive: true, sortOrder: 10, slug: "hacked" } });
    expect(patched.status).toBe(200);
    expect((patched.body as any).state).toMatchObject({ slug: "uttar-pradesh", isLive: true, sortOrder: 10 });
    const log = await prisma.auditLog.findFirst({ where: { action: "state.update", entityId: s.id } });
    expect((log!.before as any).isLive).toBe(false);
    expect((log!.after as any).isLive).toBe(true);

    expect(((await call(`/admin/states/${s.id}`, { headers: h })).body as any).state.id).toBe(s.id);
  });

  test("duplicate slug or code is a field error; bad shapes are rejected", async () => {
    const h = await as("EDITOR");
    await call("/admin/states", { method: "POST", headers: h, json: { slug: "goa", name: "Goa", code: "GA" } });
    const dupSlug = await call("/admin/states", { method: "POST", headers: h, json: { slug: "goa", name: "Goa 2", code: "GB" } });
    expect(dupSlug.status).toBe(422);
    expect((dupSlug.body as any).error.fields[0].path).toBe("slug");
    const dupCode = await call("/admin/states", { method: "POST", headers: h, json: { slug: "goa-2", name: "Goa 2", code: "GA" } });
    expect((dupCode.body as any).error.fields[0].path).toBe("code");
    expect((await call("/admin/states", { method: "POST", headers: h, json: { slug: "Bad Slug", name: "X", code: "XX" } })).status).toBe(422);
    expect((await call("/admin/states", { method: "POST", headers: h, json: { slug: "xx", name: "X", code: "x" } })).status).toBe(422);
    expect((await call("/admin/states", { method: "POST", headers: h, json: { slug: "xx", name: "   ", code: "XX" } })).status).toBe(422);
  });

  test("patching a code to another state's code is refused; unknown id is 404; empty patch is 422", async () => {
    const h = await as("EDITOR");
    await call("/admin/states", { method: "POST", headers: h, json: { slug: "goa", name: "Goa", code: "GA" } });
    const b = (await call("/admin/states", { method: "POST", headers: h, json: { slug: "bihar", name: "Bihar", code: "BR" } })).body as any;
    expect((await call(`/admin/states/${b.state.id}`, { method: "PATCH", headers: h, json: { code: "GA" } })).status).toBe(422);
    expect((await call(`/admin/states/${b.state.id}`, { method: "PATCH", headers: h, json: {} })).status).toBe(422);
    const missing = "0198a000-0000-7000-8000-000000000000";
    expect((await call(`/admin/states/${missing}`, { method: "PATCH", headers: h, json: { isLive: true } })).status).toBe(404);
    expect((await call("/admin/states/not-a-uuid", { headers: h })).status).toBe(422);
  });

  test("list: live first, filter by isLive, blank filter means no filter", async () => {
    const h = await as("EDITOR");
    await seedReferenceData();
    const all = (await call("/admin/states", { headers: h })).body as any;
    expect(all.items).toHaveLength(36);
    expect(all.items.slice(0, 8).map((s: any) => s.code)).toEqual(["UP", "MH", "RJ", "BR", "MP", "KA", "TN", "KL"]);
    expect(((await call("/admin/states?isLive=true", { headers: h })).body as any).items).toHaveLength(8);
    expect(((await call("/admin/states?isLive=false", { headers: h })).body as any).items).toHaveLength(28);
    expect(((await call("/admin/states?isLive=", { headers: h })).body as any).items).toHaveLength(36);
  });
});

describe("countries", () => {
  test("create defaults to COMING_SOON; update status, nearIndia and flight text; null clears", async () => {
    const h = await as("EDITOR");
    const c = await newCountry(h, { typicalFlightFromDelhi: "  about 5 hours " });
    const got = ((await call(`/admin/countries/${c.id}`, { headers: h })).body as any).country;
    expect(got).toMatchObject({ status: "COMING_SOON", nearIndia: false, typicalFlightFromDelhi: "about 5 hours", activeNmcNoticeCount: 0 });

    const up = await call(`/admin/countries/${c.id}`, { method: "PATCH", headers: h, json: { status: "LIVE", nearIndia: true, typicalFlightFromDelhi: null } });
    expect((up.body as any).country).toMatchObject({ status: "LIVE", nearIndia: true, typicalFlightFromDelhi: null });
    expect(await auditCount("country.update", c.id)).toBe(1);
  });

  test("duplicate slug and ISO code are field errors; ISO code must be two capitals", async () => {
    const h = await as("EDITOR");
    await newCountry(h);
    const dupSlug = await call("/admin/countries", { method: "POST", headers: h, json: { slug: "russia", name: "R2", isoCode: "RX" } });
    expect((dupSlug.body as any).error.fields[0].path).toBe("slug");
    const dupIso = await call("/admin/countries", { method: "POST", headers: h, json: { slug: "russia-2", name: "R2", isoCode: "RU" } });
    expect((dupIso.body as any).error.fields[0].path).toBe("isoCode");
    expect((await call("/admin/countries", { method: "POST", headers: h, json: { slug: "xx", name: "X", isoCode: "ru" } })).status).toBe(422);
  });

  test("list puts LIVE first and counts only ACTIVE notices", async () => {
    const h = await as("EDITOR");
    await newCountry(h, { slug: "nepal", name: "Nepal", isoCode: "NP", sortOrder: 5 });
    const ru = await newCountry(h, { status: "LIVE", sortOrder: 50 });
    const mk = (title: string, isActive: boolean) =>
      call("/admin/nmc-notices", { method: "POST", headers: h, json: { title, url: "https://nmc.org.in/n", publishedAt: iso(30), severity: "WARNING", scope: "COUNTRY", countryId: ru.id, isActive, checkedAt: iso(1) } });
    expect((await mk("active", true)).status).toBe(201);
    expect((await mk("retired", false)).status).toBe(201);
    const list = ((await call("/admin/countries", { headers: h })).body as any).items;
    expect(list.map((c: any) => c.slug)).toEqual(["russia", "nepal"]);
    expect(list[0].activeNmcNoticeCount).toBe(1);
    expect(((await call("/admin/countries?status=COMING_SOON", { headers: h })).body as any).items).toHaveLength(1);
  });
});

describe("sources", () => {
  const body = { kind: "NTA", title: "NEET (UG) 2026 result notice", publisher: "National Testing Agency", url: "https://exams.nta.nic.in/neet/" };

  test("create, update, clear, delete; all audited", async () => {
    const h = await as("EDITOR");
    const created = await call("/admin/sources", { method: "POST", headers: h, json: body });
    expect(created.status).toBe(201);
    const s = (created.body as any).source;
    expect(s).toMatchObject({ kind: "NTA", title: body.title, url: body.url, notes: null });

    const up = await call(`/admin/sources/${s.id}`, { method: "PATCH", headers: h, json: { kind: "OTHER", notes: "  checked  ", url: null, publisher: "" } });
    expect((up.body as any).source).toMatchObject({ kind: "OTHER", notes: "checked", url: null, publisher: null });

    expect((await call(`/admin/sources/${s.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await call(`/admin/sources/${s.id}`, { headers: h })).status).toBe(404);
    expect((await call(`/admin/sources/${s.id}`, { method: "DELETE", headers: h })).status).toBe(404);
    for (const a of ["source.create", "source.update", "source.delete"]) expect(await auditCount(a, s.id)).toBe(1);
  });

  test("only http(s) links are accepted (no javascript: links)", async () => {
    const h = await as("EDITOR");
    for (const url of ["javascript:alert(1)", "ftp://x.example/file", "nmc.org.in", "https://", "https://exa mple.com"]) {
      const res = await call("/admin/sources", { method: "POST", headers: h, json: { ...body, url } });
      expect(res.status).toBe(422);
    }
    expect((await call("/admin/sources", { method: "POST", headers: h, json: { ...body, url: null } })).status).toBe(201);
    expect((await call("/admin/sources", { method: "POST", headers: h, json: { kind: "BOGUS", title: "x" } })).status).toBe(422);
  });

  test("list filters by kind and search text, pages with a cursor, newest first", async () => {
    const h = await as("EDITOR");
    for (let i = 1; i <= 5; i++) await call("/admin/sources", { method: "POST", headers: h, json: { kind: i % 2 ? "NMC" : "WDOMS", title: `Doc ${i}`, publisher: i === 3 ? "Medical Council" : null } });
    const p1 = (await call("/admin/sources?limit=2", { headers: h })).body as any;
    expect(p1.items.map((s: any) => s.title)).toEqual(["Doc 5", "Doc 4"]);
    const p2 = (await call(`/admin/sources?limit=2&cursor=${p1.nextCursor}`, { headers: h })).body as any;
    expect(p2.items.map((s: any) => s.title)).toEqual(["Doc 3", "Doc 2"]);
    const p3 = (await call(`/admin/sources?limit=2&cursor=${p2.nextCursor}`, { headers: h })).body as any;
    expect(p3.items).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();
    expect(((await call("/admin/sources?kind=WDOMS", { headers: h })).body as any).items).toHaveLength(2);
    expect(((await call("/admin/sources?q=medical", { headers: h })).body as any).items.map((s: any) => s.title)).toEqual(["Doc 3"]);
    expect(((await call("/admin/sources?q=&kind=&limit=&cursor=", { headers: h })).body as any).items).toHaveLength(5);
  });
});

describe("NMC notices", () => {
  const base = (countryId: string) => ({
    title: "NMC advisory on foreign medical education",
    url: "https://www.nmc.org.in/notice",
    publishedAt: "2026-09-15",
    severity: "WARNING",
    scope: "COUNTRY",
    countryId,
    checkedAt: iso(2),
  });

  test("create with a date-only publishedAt, embed the country, default active", async () => {
    const h = await as("EDITOR");
    const ru = await newCountry(h);
    const res = await call("/admin/nmc-notices", { method: "POST", headers: h, json: base(ru.id) });
    expect(res.status).toBe(201);
    const n = (res.body as any).notice;
    expect(n).toMatchObject({ isActive: true, scope: "COUNTRY", collegeId: null, country: { id: ru.id, slug: "russia", name: "Russia" } });
    expect(n.publishedAt).toBe("2026-09-15T00:00:00.000Z");
    expect(await auditCount("nmc_notice.create", n.id)).toBe(1);
  });

  test("rejects: college scope, missing/unknown country, future dates, bad urls", async () => {
    const h = await as("EDITOR");
    const ru = await newCountry(h);
    const post = (over: Record<string, unknown>) => call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base(ru.id), ...over } });
    const field = (r: any) => r.body.error.fields[0].path;

    const college = await post({ scope: "COLLEGE", countryId: undefined });
    expect([college.status, field(college)]).toEqual([422, "scope"]);
    const noCountry = await post({ countryId: undefined });
    expect([noCountry.status, field(noCountry)]).toEqual([422, "countryId"]);
    const unknown = await post({ countryId: "0198a000-0000-7000-8000-000000000000" });
    expect([unknown.status, field(unknown)]).toEqual([422, "countryId"]);
    const future = await post({ checkedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    expect([future.status, field(future)]).toEqual([422, "checkedAt"]);
    expect((await post({ publishedAt: "2099-01-01" })).status).toBe(422);
    expect((await post({ url: "javascript:alert(1)" })).status).toBe(422);
    expect((await post({ publishedAt: "yesterday" })).status).toBe(422);
    expect(await prisma.nmcNotice.count()).toBe(0);
  });

  test("update: re-confirm with a new checkedAt, retire, move country; delete is audited", async () => {
    const h = await as("EDITOR");
    const ru = await newCountry(h);
    const kz = await newCountry(h, { slug: "kazakhstan", name: "Kazakhstan", isoCode: "KZ" });
    const n = ((await call("/admin/nmc-notices", { method: "POST", headers: h, json: base(ru.id) })).body as any).notice;

    const checkedAt = iso(0);
    const up = (await call(`/admin/nmc-notices/${n.id}`, { method: "PATCH", headers: h, json: { checkedAt, isActive: false, countryId: kz.id, severity: "ADVISORY" } })).body as any;
    expect(up.notice).toMatchObject({ isActive: false, severity: "ADVISORY", country: { slug: "kazakhstan" } });
    expect(new Date(up.notice.checkedAt).getTime()).toBe(new Date(checkedAt).getTime());
    expect(((await call(`/admin/countries/${kz.id}`, { headers: h })).body as any).country.activeNmcNoticeCount).toBe(0);

    expect((await call(`/admin/nmc-notices/${n.id}`, { method: "PATCH", headers: h, json: {} })).status).toBe(422);
    expect((await call(`/admin/nmc-notices/${n.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await call(`/admin/nmc-notices/${n.id}`, { headers: h })).status).toBe(404);
    expect(await auditCount("nmc_notice.delete", n.id)).toBe(1);
  });

  test("a country with notices cannot be removed from the database (restrict)", async () => {
    const h = await as("EDITOR");
    const ru = await newCountry(h);
    await call("/admin/nmc-notices", { method: "POST", headers: h, json: base(ru.id) });
    await expect((async () => prisma.country.delete({ where: { id: ru.id } }))()).rejects.toThrow();
  });

  test("list filters by country, scope and active flag", async () => {
    const h = await as("EDITOR");
    const ru = await newCountry(h);
    const kz = await newCountry(h, { slug: "kazakhstan", name: "Kazakhstan", isoCode: "KZ" });
    await call("/admin/nmc-notices", { method: "POST", headers: h, json: base(ru.id) });
    await call("/admin/nmc-notices", { method: "POST", headers: h, json: { ...base(kz.id), isActive: false } });
    const q = async (qs: string) => ((await call(`/admin/nmc-notices${qs}`, { headers: h })).body as any).items.length;
    expect(await q("")).toBe(2);
    expect(await q(`?countryId=${ru.id}`)).toBe(1);
    expect(await q("?isActive=false")).toBe(1);
    expect(await q("?scope=COLLEGE")).toBe(0);
    expect(await q("?isActive=&countryId=")).toBe(2);
  });
});

describe("seed", () => {
  test("inserts 36 states and 8 countries, and a re-run changes nothing (staff edits survive)", async () => {
    const first = await seedReferenceData();
    expect(first).toEqual({ statesInserted: 36, countriesInserted: 8 });
    expect(await prisma.state.count({ where: { isLive: true } })).toBe(8);
    expect(await prisma.country.count({ where: { status: "LIVE" } })).toBe(5);
    expect((await prisma.country.findMany({ where: { nearIndia: true } })).map((c) => c.slug).sort()).toEqual(["bangladesh", "nepal"]);

    await prisma.state.update({ where: { slug: "goa" }, data: { isLive: true, name: "Goa (edited)" } });
    expect(await seedReferenceData()).toEqual({ statesInserted: 0, countriesInserted: 0 });
    expect(await prisma.state.findUnique({ where: { slug: "goa" } })).toMatchObject({ isLive: true, name: "Goa (edited)" });
  });

  test("every seeded slug, code and ISO code is well-formed", async () => {
    await seedReferenceData();
    for (const s of await prisma.state.findMany()) {
      expect(s.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.code).toMatch(/^[A-Z]{2,3}$/);
    }
    for (const c of await prisma.country.findMany()) expect(c.isoCode).toMatch(/^[A-Z]{2}$/);
  });
});
