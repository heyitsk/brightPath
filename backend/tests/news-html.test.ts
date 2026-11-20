import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { AdapterError } from "../src/modules/news/adapters";
import { cleanTitle, extractHtmlList, orderNewestFirst } from "../src/modules/news/adapters/html-list";
import { decodeBody, setFetchImplementation } from "../src/modules/news/fetcher";
import { runSource } from "../src/modules/news/ingest";
import { findDateInText } from "../src/modules/news/text";
import { HTML_SETUP, NEWS_SOURCES, seedNewsSources } from "../prisma/seed/news";
import { seedReferenceData } from "../prisma/seed/reference";
import { FIXTURE_DIR, snapshot } from "../scripts/news-golden";
import expected from "./fixtures/news/expected.json";

const NOW = new Date("2026-11-21T10:00:00Z");
const run = (html: string, config: Record<string, unknown>, url = "https://site.example/page/") => extractHtmlList({ body: html, url, config, now: NOW });

async function wipe() {
  await prisma.newsItem.deleteMany();
  await prisma.newsFetchRun.deleteMany();
  await prisma.newsSource.deleteMany();
}
beforeEach(wipe);
afterEach(() => setFetchImplementation());
afterAll(wipe);

// ---- dates and titles --------------------------------------------------------------------

describe("dates written by people", () => {
  const d = (text: string) => findDateInText(text, NOW)?.toISOString().slice(0, 10) ?? null;

  test("the formats Indian sites use, day first", () => {
    expect(d("Notice dated 19.11.2026 regarding")).toBe("2026-11-19");
    expect(d("Advt. No. 128 dated-19.11.2026 Notice")).toBe("2026-11-19");
    expect(d("[17-11-2026] - NOTICE")).toBe("2026-11-17");
    expect(d("17/11/26")).toBe("2026-11-17");
    expect(d("20-Nov 2026")).toBe("2026-11-20");
    expect(d("20 Nov 2026")).toBe("2026-11-20");
    expect(d("5th November, 2026")).toBe("2026-11-05");
    expect(d("Nov 5, 2026")).toBe("2026-11-05");
    expect(d("(Held on 21st June, 2026)")).toBe("2026-06-21");
  });

  test("not dates: absurd, future, impossible, or part of a longer number", () => {
    expect(d("established 29.03.2001")).toBeNull(); // too old to be a notice
    expect(d("Last date 25-11-2026")).toBeNull(); // four days ahead
    expect(d("31/02/2026")).toBeNull();
    expect(d("13/13/2026")).toBeNull();
    expect(d("Order No. 2024/12/2026/17")).toBeNull();
    expect(d("academic year 2026-27")).toBeNull();
    expect(d("no date here")).toBeNull();
  });

  test("the first date in the text wins, and a date is noon in India so every time zone agrees on the day", () => {
    expect(d("18.11.2026 corrected on 19.11.2026")).toBe("2026-11-18");
    expect(findDateInText("17-11-2026", NOW)!.toISOString()).toBe("2026-11-17T06:30:00.000Z");
  });
});

describe("titles", () => {
  test("date prefixes, file sizes and trailing labels are not part of the title", () => {
    expect(cleanTitle("[17-11-2026] - NOTICE : GENERAL INFORMATION FOR PG MEDICAL")).toBe("NOTICE : GENERAL INFORMATION FOR PG MEDICAL");
    expect(cleanTitle("17/11/2026 - Gazette Notification dated 12.11.2026 of draft rules")).toBe("Gazette Notification dated 12.11.2026 of draft rules");
    expect(cleanTitle("Opening of National Scholarship Portal Download (0.52 MB)")).toBe("Opening of National Scholarship Portal");
    expect(cleanTitle("  Seat   matrix\n round 2  NEW ")).toBe("Seat matrix round 2");
  });

  test("Hindi, Marathi and Tamil titles keep every letter (a regression: a punctuation pattern once ate the first letter)", () => {
    expect(cleanTitle("20-11-2026 प्रवेश वर्ष 2026 बी.एससी. नर्सिंग")).toBe("प्रवेश वर्ष 2026 बी.एससी. नर्सिंग");
    expect(cleanTitle("शैक्षणिक वर्ष २०२७-२८ करिता प्रवेश परीक्षांबाबत प्रसिद्धीपत्रक")).toBe("शैक्षणिक वर्ष २०२७-२८ करिता प्रवेश परीक्षांबाबत प्रसिद्धीपत्रक");
    expect(cleanTitle("2026 - TN MBBS & BDS அப்ளிகேஷன் செய்யும் முறை")).toBe("2026 - TN MBBS & BDS அப்ளிகேஷன் செய்யும் முறை"); // a year is not a date
  });
});

// ---- the reader on small pages ------------------------------------------------------------

const PAGE = `<html><body>
  <ul class="menu"><li><a href="/about">About the department of medical education</a></li></ul>
  <div id="notices">
    <ul>
      <li><a href="/files/a.pdf">Counselling schedule for MBBS round 1 admissions</a> <span>19-11-2026</span></li>
      <li><a href="files/b.pdf?utm_source=x#top">Seat matrix for state quota MBBS seats 2026</a> 18/11/2026</li>
      <li><a href="/files/a.pdf">Counselling schedule for MBBS round 1 admissions</a></li>
      <li><a href="javascript:void(0)">A link that goes nowhere at all really</a></li>
      <li><a href="#">Another link to the same page itself</a></li>
      <li><a href="/more">Read more...</a></li>
      <li><a href="/short">Hi</a></li>
    </ul>
  </div>
</body></html>`;

describe("HTML reader", () => {
  test("reads only the scope, resolves addresses, strips tracking, skips non-pages, nav labels and repeats", () => {
    const out = run(PAGE, { scope: "#notices" });
    expect(out.map((o) => o.url)).toEqual(["https://site.example/files/a.pdf", "https://site.example/page/files/b.pdf"]);
    expect(out.map((o) => o.sourcePublishedAt?.toISOString().slice(0, 10))).toEqual(["2026-11-19", "2026-11-18"]);
    expect(out.every((o) => o.dateBasis === "SOURCE")).toBe(true);
  });

  test("without a scope it refuses to guess; with the wrong scope it says the layout changed (so health notices)", () => {
    expect(() => run(PAGE, {})).toThrow(/no "scope" setting/);
    expect(() => run(PAGE, { scope: "#gone" })).toThrow(/was not found on the page/);
    expect(() => run(PAGE, { scope: "#gone" })).toThrow(AdapterError);
    expect(run(PAGE, { generic: true }).length).toBeGreaterThan(2); // trying a new site out
    expect(() => run(PAGE, { scope: "#notices", skipText: ["("] })).toThrow(/invalid pattern/);
  });

  test("exclude, skipText, onlyText, onlyHref, skipHref, minTitleLength, maxItems", () => {
    expect(run(PAGE, { scope: "#notices", skipText: ["seat matrix"] })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", onlyText: ["seat matrix"] })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", onlyHref: ["b\\.pdf"] })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", skipHref: ["b\\.pdf"] })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", exclude: ["li:nth-child(1), li:nth-child(3)"] })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", maxItems: 1 })).toHaveLength(1);
    expect(run(PAGE, { scope: "#notices", minTitleLength: 60 })).toHaveLength(0);
  });

  test("a date shared by several links in one block is ambiguous and is not used (the page's own clock, a section date)", () => {
    const html = `<div id="n"><div class="row">Today 21-11-2026
      <a href="/a">First notice about admissions counselling</a> <a href="/b">Second notice about seat matrix</a></div></div>`;
    const out = run(html, { scope: "#n", row: ".row" });
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.sourcePublishedAt === null && o.dateBasis === "FIRST_SEEN")).toBe(true);
  });

  test("a date in the title still counts even when the row is shared", () => {
    const html = `<div id="n"><div class="row"><a href="/a">Notice of 19.11.2026 about counselling</a> <a href="/b">Second notice about seat matrix</a></div></div>`;
    const out = run(html, { scope: "#n", row: ".row" });
    expect(out.map((o) => o.sourcePublishedAt?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-11-19", null]);
  });

  test("table sites: title and date from their columns, even when the link is only an icon", () => {
    const html = `<table id="t"><tr><td data-column="SN">1</td><td data-column="Subject">Notice regarding CET 2027 schedule</td><td data-column="Date">16/11/2026</td><td><a href="/x.pdf"><i class="icon"></i></a></td></tr></table>`;
    const out = run(html, { scope: "#t", row: "tr", titleSelector: 'td[data-column="Subject"]', dateSelector: 'td[data-column="Date"]' });
    expect(out).toEqual([{ title: "Notice regarding CET 2027 schedule", url: "https://site.example/x.pdf", sourcePublishedAt: new Date("2026-11-16T06:30:00Z"), dateBasis: "SOURCE", snippet: null }]);
    // with no title column named, an icon-only link falls back to the row's text
    const fallback = run(html, { scope: "#t", row: "tr" });
    expect(fallback[0]!.title).toContain("Notice regarding CET 2027 schedule");
  });

  test("the date can come from the file name (dateFromUrl)", () => {
    const html = `<ul id="n"><li><a href="news/2026-11-20-NOTIFICATION - DOCUMENT VERIFICATION.pdf">Notification for document verification</a> | <a href="news/2026-11-19-LIST.pdf">List of candidates for counselling</a></li></ul>`;
    const out = run(html, { scope: "#n", dateFromUrl: "(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})-" });
    expect(out.map((o) => o.sourcePublishedAt?.toISOString().slice(0, 10))).toEqual(["2026-11-20", "2026-11-19"]);
  });

  test("a page that lists oldest first is turned around, judged from its dates; a mixed page is left alone", () => {
    const mk = (d: string) => ({ title: "t", url: `https://x/${d}`, sourcePublishedAt: new Date(`${d}T06:30:00Z`), dateBasis: "SOURCE" as const });
    const asc = ["2026-11-01", "2026-11-05", "2026-11-09", "2026-11-12", "2026-11-18"].map(mk);
    expect(orderNewestFirst(asc, "auto").map((i) => i.url.slice(-5))).toEqual(["11-18", "11-12", "11-09", "11-05", "11-01"]);
    const desc = [...asc].reverse();
    expect(orderNewestFirst(desc, "auto")).toEqual(desc);
    const mixed = ["2026-11-10", "2026-11-18", "2026-11-05", "2026-11-12", "2026-11-01"].map(mk);
    expect(orderNewestFirst(mixed, "auto")).toEqual(mixed);
    expect(orderNewestFirst(asc, "newest-first")).toEqual(asc);
    expect(orderNewestFirst(asc, "oldest-first")[0]!.url).toContain("11-18");
    expect(orderNewestFirst(asc.slice(0, 2), "auto")).toEqual(asc.slice(0, 2)); // too few dates to judge
  });
});

describe("page encodings", () => {
  test("a page that declares a non-UTF-8 charset is decoded with it", () => {
    const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café" in ISO-8859-1
    expect(decodeBody(latin1.buffer, "text/html; charset=iso-8859-1")).toBe("Café");
    const withMeta = new TextEncoder().encode('<html><head><meta charset="windows-1252"></head>').buffer;
    expect(decodeBody(withMeta, "text/html")).toContain("windows-1252");
    expect(decodeBody(new TextEncoder().encode("नमस्ते").buffer, "text/html")).toBe("नमस्ते");
    expect(decodeBody(new TextEncoder().encode("ok").buffer, "text/html; charset=nonsense-9")).toBe("ok");
  });
});

// ---- the real sites, from saved pages ------------------------------------------------------

describe("saved pages of the real sites", () => {
  const slugs = Object.keys(expected);

  test("every site with settings has a saved page and expected results", () => {
    const configured = Object.entries(HTML_SETUP).filter(([, s]) => Object.keys(s.config).length > 0).map(([slug]) => slug);
    expect(slugs.sort()).toEqual(configured.sort());
    for (const slug of slugs) expect(existsSync(`${FIXTURE_DIR}${slug}.html`)).toBe(true);
  });

  for (const slug of Object.keys(expected)) {
    test(`${slug}: finds the expected notices`, () => {
      expect(snapshot(slug)).toEqual((expected as any)[slug]);
    });
  }

  test("every notice from every site has a clean title, an absolute http(s) address and no repeats", async () => {
    for (const slug of slugs) {
      const setup = HTML_SETUP[slug]!;
      const url = setup.listUrl ?? NEWS_SOURCES.find((s) => s.slug === slug)!.listUrl;
      const html = await Bun.file(`${FIXTURE_DIR}${slug}.html`).text();
      const items = extractHtmlList({ body: html, url, config: setup.config, now: NOW });
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map((i) => i.url)).size).toBe(items.length);
      for (const i of items) {
        expect(i.url).toMatch(/^https?:\/\//);
        expect(i.title).toBe(i.title.trim());
        expect(i.title).not.toMatch(/\s{2,}/);
        expect(i.title.length).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

// ---- registry and a real run through the pipeline -----------------------------------------

describe("source registry", () => {
  test("every source that is switched on can be read; every one that is off says why", async () => {
    await seedReferenceData();
    await seedNewsSources();
    const sources = await prisma.newsSource.findMany();
    expect(sources).toHaveLength(NEWS_SOURCES.length);
    for (const s of sources) {
      if (s.isActive) {
        expect(["RSS", "WP_REST", "HTML_LIST"]).toContain(s.kind);
        if (s.kind === "HTML_LIST") expect(Object.keys(s.config as object).length).toBeGreaterThan(0);
      } else {
        expect(s.notes ?? "").not.toBe("");
      }
    }
    expect(sources.filter((s) => s.isActive).length).toBeGreaterThanOrEqual(18);
  });

  test("seeding again changes nothing; a source staff have edited is never overwritten", async () => {
    await seedReferenceData();
    await seedNewsSources();
    const edited = await prisma.newsSource.update({ where: { slug: "goa-dte" }, data: { config: { scope: "main" }, notes: "edited by staff" } });
    const again = await seedNewsSources();
    expect(again).toMatchObject({ created: 0, upgraded: 0 });
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({ config: { scope: "main" }, notes: "edited by staff" });
  });

  test("an HTML source with no settings fails with a plain reason instead of reading the whole page", async () => {
    const s = await prisma.newsSource.create({ data: { slug: "bare", name: "Bare", kind: "HTML_LIST", listUrl: "https://site.example/", isActive: true } });
    setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response(PAGE, { status: 200 })));
    const r = await runSource(s.id, NOW);
    expect(r).toMatchObject({ outcome: "ERROR" });
    expect(r.error).toContain('no "scope" setting');
  });

  test("a real run: an HTML page becomes pending notices; the same page again adds nothing; a changed layout is reported", async () => {
    const s = await prisma.newsSource.create({ data: { slug: "page", name: "Page", kind: "HTML_LIST", listUrl: "https://site.example/page/", isActive: true, config: { scope: "#notices" } } });
    setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } })));
    expect(await runSource(s.id, NOW)).toMatchObject({ outcome: "OK", itemsFound: 2, itemsNew: 2 });
    expect(await prisma.newsItem.count({ where: { sourceId: s.id, status: "PENDING" } })).toBe(2);
    expect(await runSource(s.id, NOW)).toMatchObject({ outcome: "OK", itemsFound: 2, itemsNew: 0 });

    setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response("<html><body><div id='redesigned'></div></body></html>", { status: 200 })));
    const broken = await runSource(s.id, NOW);
    expect(broken).toMatchObject({ outcome: "ERROR" });
    expect(broken.error).toContain("layout");
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ consecutiveFailures: 1, lastError: expect.stringContaining("layout") });
  });
});
