import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { AdapterError } from "../src/modules/news/adapters";
import { extractHtmlList } from "../src/modules/news/adapters/html-list";
import { extractJsonList, getPath } from "../src/modules/news/adapters/json-list";
import { setFetchImplementation } from "../src/modules/news/fetcher";
import { runSource } from "../src/modules/news/ingest";
import { parseSiteDate } from "../src/modules/news/text";
import { HTML_SETUP, NEWS_SOURCES, seedNewsSources } from "../prisma/seed/news";
import { seedReferenceData } from "../prisma/seed/reference";
import { cleanup, createStaff, loginAs } from "./admin-helpers";
import { call } from "./helpers";

const NOW = new Date("2026-11-21T10:00:00Z");
const emails: string[] = [];
async function wipe() {
  await prisma.newsItem.deleteMany();
  await prisma.newsFetchRun.deleteMany();
  await prisma.newsSource.deleteMany();
}
beforeEach(wipe);
afterEach(() => setFetchImplementation());
afterAll(async () => {
  await wipe();
  await cleanup(emails);
});

const API = "https://api.example/webapi/list";
const run = (doc: unknown, config: Record<string, unknown>) => extractJsonList({ body: typeof doc === "string" ? doc : JSON.stringify(doc), url: API, config, now: NOW });
const BASE = { itemsPath: "Data.Latest", titlePath: "Title", urlTemplate: "https://site.example/notice/{Id}", datePath: "Date" };

describe("dates as sites write them in data", () => {
  const d = (v: string) => parseSiteDate(v, NOW)?.toISOString() ?? null;
  test("a date with no zone is the Indian calendar day, whatever zone the server is in", () => {
    expect(d("2026-11-20T00:00:00")).toBe("2026-11-20T06:30:00.000Z");
    expect(d("2026-11-20")).toBe("2026-11-20T06:30:00.000Z");
    expect(d("2026-11-20 14:05:00")).toBe("2026-11-20T06:30:00.000Z");
  });
  test("a date with a zone, a written date, junk and the future", () => {
    expect(d("2026-11-20T10:00:00Z")).toBe("2026-11-20T10:00:00.000Z");
    expect(d("20-11-2026")).toBe("2026-11-20T06:30:00.000Z");
    expect(d("not a date")).toBeNull();
    expect(d("2026-12-30")).toBeNull();
    expect(d("1999-01-01")).toBeNull();
  });
});

describe("JSON list reader", () => {
  const DOC = { Data: { Latest: [{ Id: 7, Title: "Counselling schedule for MBBS round 2", Date: "2026-11-20T00:00:00" }, { Id: 6, Title: "Seat matrix for MBBS state quota", Date: "2026-11-18T00:00:00" }] } };

  test("reads the list: title, address from the template, date, order as given", () => {
    const out = run(DOC, BASE);
    expect(out.map((o) => [o.title, o.url, o.sourcePublishedAt?.toISOString().slice(0, 10), o.dateBasis])).toEqual([
      ["Counselling schedule for MBBS round 2", "https://site.example/notice/7", "2026-11-20", "SOURCE"],
      ["Seat matrix for MBBS state quota", "https://site.example/notice/6", "2026-11-18", "SOURCE"],
    ]);
  });

  test("the address can come from the item (relative ones are resolved), or fall back to the template", () => {
    const doc = { Data: { Latest: [{ Id: 1, Title: "Notice with its own address here", Link: "/files/a.pdf" }, { Id: 2, Title: "Notice with no address of its own" }] } };
    const out = run(doc, { ...BASE, urlPath: "Link", datePath: undefined });
    expect(out.map((o) => o.url)).toEqual(["https://api.example/files/a.pdf", "https://site.example/notice/2"]);
    expect(out.every((o) => o.dateBasis === "FIRST_SEEN" && o.sourcePublishedAt === null)).toBe(true);
  });

  test("several lists can be joined; nested names use dots; an item with a missing template field is skipped, not given a wrong address", () => {
    const doc = { Data: { A: [{ Id: 1, Title: "First notice about counselling" }], B: [{ Id: 2, Title: "Second notice about seats" }, { Title: "Third notice has no id at all" }] } };
    const out = run(doc, { ...BASE, itemsPath: ["Data.A", "Data.B"] });
    expect(out.map((o) => o.url)).toEqual(["https://site.example/notice/1", "https://site.example/notice/2"]);
    expect(getPath({ a: { b: [1] } }, "a.b")).toEqual([1]);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });

  test("short titles, repeats and html in titles are handled; maxItems and minTitleLength apply", () => {
    const doc = { Data: { Latest: [{ Id: 1, Title: "Affidavit" }, { Id: 2, Title: "<b>Seat</b> matrix &amp; fees notice" }, { Id: 2, Title: "Seat matrix and fees notice again" }, { Id: 3, Title: "Another notice about the counselling" }] } };
    expect(run(doc, BASE).map((o) => o.title)).toEqual(["Seat matrix & fees notice", "Another notice about the counselling"]);
    expect(run(doc, { ...BASE, maxItems: 1 })).toHaveLength(1);
    expect(run(doc, { ...BASE, minTitleLength: 5 })).toHaveLength(3);
  });

  test("a list oldest first is turned around from its dates", () => {
    const mk = (id: number, day: number) => ({ Id: id, Title: `Notice number ${id} about counselling`, Date: `2026-11-${String(day).padStart(2, "0")}T00:00:00` });
    const out = run({ Data: { Latest: [mk(1, 1), mk(2, 5), mk(3, 9), mk(4, 12), mk(5, 18)] } }, BASE);
    expect(out.map((o) => o.url.slice(-1))).toEqual(["5", "4", "3", "2", "1"]);
  });

  test("missing settings, non-JSON, and a list that moved are reported in plain words", () => {
    expect(() => run(DOC, { itemsPath: "Data.Latest", titlePath: "Title" })).toThrow(/needs the settings/);
    expect(() => run(DOC, {})).toThrow(AdapterError);
    expect(() => run("<html>Maintenance</html>", BASE)).toThrow(/did not return JSON/);
    expect(() => run({ Data: {} }, BASE)).toThrow(/was not found in the answer/);
    expect(() => run({ Data: { Latest: "oops" } }, BASE)).toThrow(/data format/);
  });
});

describe("postback links (pages whose notices open through a button)", () => {
  const TICKER = `<div id="t"><span><a href="javascript:__doPostBack('R$ctl00$lnk','')">REVISED SEAT MATRIX FOR UP NEET UG COUNSELING ROUND 5</a></span>
    <span><a href="javascript:__doPostBack('R$ctl01$lnk','')">UP STATE MERIT LIST OF NEET-UG 2026 FIFTH ROUND</a></span>
    <span><a href="javascript:__doPostBack('R$ctl02$lnk','')">UP STATE MERIT LIST OF NEET-UG 2026 FIFTH ROUND</a></span>
    <span><a href="javascript:void(0)">Some other javascript link goes nowhere</a></span></div>`;
  const read = (config: Record<string, unknown>) => extractHtmlList({ body: TICKER, url: "https://counsel.example/", config, now: NOW });

  test("without the setting they are ignored, as before", () => {
    expect(read({ scope: "#t" })).toEqual([]);
  });

  test("with it, each notice gets the page's address plus a mark made from its title, stable when the list shifts", () => {
    const first = read({ scope: "#t", postbackLinks: true });
    expect(first).toHaveLength(2); // the repeated title is one notice; the plain javascript link is not a notice
    expect(first[0]!.url).toMatch(/^https:\/\/counsel\.example\/\?notice=[0-9a-f]{12}$/);
    expect(first[0]!.url).not.toBe(first[1]!.url);
    // a new notice at the top moves everyone down one place (ctl00 becomes ctl01...) but the addresses stay put
    const shifted = extractHtmlList({
      body: TICKER.replace("<span>", `<span><a href="javascript:__doPostBack('R$ctl09$lnk','')">A BRAND NEW NOTICE FOR MBBS COUNSELLING</a></span><span>`),
      url: "https://counsel.example/",
      config: { scope: "#t", postbackLinks: true },
      now: NOW,
    });
    expect(shifted).toHaveLength(3);
    expect(shifted.slice(1).map((i) => i.url)).toEqual(first.map((i) => i.url));
  });
});

describe("JSON sources in a real run", () => {
  const source = (over: Record<string, unknown> = {}) =>
    prisma.newsSource.create({ data: { slug: "json-src", name: "Json", kind: "JSON_LIST", listUrl: API, isActive: true, config: BASE, ...over } });
  const DOC = { Data: { Latest: [{ Id: 7, Title: "Counselling schedule for MBBS round 2", Date: "2026-11-20T00:00:00" }] } };

  test("asks for JSON explicitly (some APIs answer in XML otherwise) and stores the notices", async () => {
    const s = await source();
    let accept = "";
    setFetchImplementation(async (u, init) => {
      if (u.endsWith("robots.txt")) return new Response("", { status: 404 });
      accept = (init.headers as Record<string, string>).accept!;
      return new Response(JSON.stringify(DOC), { status: 200, headers: { "content-type": "application/json" } });
    });
    const r = await runSource(s.id, NOW);
    expect(accept).toBe("application/json");
    expect(r).toMatchObject({ outcome: "OK", itemsFound: 1, itemsNew: 1 });
    expect(await prisma.newsItem.findFirstOrThrow({ where: { sourceId: s.id } })).toMatchObject({ originalUrl: "https://site.example/notice/7", status: "PENDING", dateBasis: "SOURCE" });
  });

  test("a changed data format fails the run with a plain reason, so health notices", async () => {
    const s = await source();
    setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response(JSON.stringify({ Data: { Other: [] } }), { status: 200 })));
    const r = await runSource(s.id, NOW);
    expect(r.outcome).toBe("ERROR");
    expect(r.error).toContain("data format");
  });

  test("the admin can add a JSON source, test it, and it may be switched on", async () => {
    const u = await createStaff("EDITOR");
    emails.push(u.email);
    const h = await loginAs(u.email);
    const created = await call("/admin/news/sources", { method: "POST", headers: h, json: { slug: "json-two", name: "Json two", kind: "JSON_LIST", listUrl: API, config: BASE, isActive: true } });
    expect(created.status).toBe(201);
    expect((created.body as any).source).toMatchObject({ kind: "JSON_LIST", canFetch: true, isActive: true });
    setFetchImplementation(async (u2) => (u2.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response(JSON.stringify(DOC), { status: 200 })));
    const test = await call(`/admin/news/sources/${(created.body as any).source.id}/test`, { method: "POST", headers: h });
    expect(test.body).toMatchObject({ ok: true, itemsFound: 1 });
    expect((test.body as any).items[0]).toMatchObject({ relevant: true, title: "Counselling schedule for MBBS round 2" });
    const jsKind = await call("/admin/news/sources", { method: "POST", headers: h, json: { slug: "js-one", name: "Js one", kind: "HTML_JS", listUrl: API, isActive: true } });
    expect(jsKind.status).toBe(422);
  });
});

describe("the N5 sources", () => {
  test("seeding sets up the four newly readable sources and leaves the five unreadable ones off with a reason", async () => {
    await seedReferenceData();
    await seedNewsSources();
    const by = async (slug: string) => prisma.newsSource.findUniqueOrThrow({ where: { slug } });
    expect(await by("westbengal-wbmcc")).toMatchObject({ kind: "HTML_LIST", isActive: true, listUrl: "https://wbmcc.nic.in/ug-medical-dental-counselling/" });
    expect(await by("gujarat-medadm")).toMatchObject({ kind: "HTML_LIST", isActive: true });
    expect(await by("up-neet")).toMatchObject({ kind: "HTML_LIST", isActive: true, config: expect.objectContaining({ postbackLinks: true, allowInsecureTls: true }) });
    expect(await by("rajasthan-dme")).toMatchObject({ kind: "JSON_LIST", isActive: true });
    for (const slug of ["central-mcc", "assam-dme", "mp-dme", "mizoram-mc", "punjab-bfuhs"]) {
      const s = await by(slug);
      expect(s).toMatchObject({ kind: "HTML_JS", isActive: false });
      expect(s.notes).toContain("OFF");
    }
    expect((await by("central-mcc")).notes).toContain("403");
    expect((await by("central-nta-neet")).isActive).toBe(false);
  });

  test("a source created by an earlier seed (old kind, old note) is brought up to date; seeding again changes nothing", async () => {
    await seedReferenceData();
    await prisma.newsSource.create({ data: { slug: "westbengal-wbmcc", name: "WB", kind: "HTML_JS", listUrl: "https://wbmcc.nic.in/", isActive: false, notes: "The home page has no notice links in the HTML the server sends. Needs step N5." } });
    await prisma.newsSource.create({ data: { slug: "punjab-bfuhs", name: "Punjab", kind: "HTML_JS", listUrl: "https://bfuhs.ac.in/", isActive: false, notes: "The page is built by JavaScript, so it needs the headless-browser fetcher (step N5)." } });
    await prisma.newsSource.create({ data: { slug: "mp-dme", name: "MP", kind: "HTML_JS", listUrl: "https://dme.mponline.gov.in/", isActive: false, notes: "Staff wrote this note themselves." } });
    const first = await seedNewsSources();
    expect(first.upgraded).toBe(2);
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { slug: "westbengal-wbmcc" } })).toMatchObject({ kind: "HTML_LIST", isActive: true });
    expect((await prisma.newsSource.findUniqueOrThrow({ where: { slug: "punjab-bfuhs" } })).notes).toContain("OFF");
    expect((await prisma.newsSource.findUniqueOrThrow({ where: { slug: "mp-dme" } })).notes).toBe("Staff wrote this note themselves.");
    expect((await seedNewsSources()).upgraded).toBe(0);
  });

  test("settings for every readable source exist, and the unreadable ones carry the HTML_JS kind", () => {
    const kindOf = (slug: string) => HTML_SETUP[slug]?.kind ?? NEWS_SOURCES.find((s) => s.slug === slug)!.kind;
    expect(["westbengal-wbmcc", "gujarat-medadm", "up-neet"].map(kindOf)).toEqual(["HTML_LIST", "HTML_LIST", "HTML_LIST"]);
    expect(kindOf("rajasthan-dme")).toBe("JSON_LIST");
    expect(["central-mcc", "assam-dme", "mp-dme", "mizoram-mc", "punjab-bfuhs"].map(kindOf)).toEqual(Array(5).fill("HTML_JS"));
  });
});
