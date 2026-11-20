import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { AdapterError } from "../src/modules/news/adapters";
import { extractRss } from "../src/modules/news/adapters/rss";
import { extractWpRest } from "../src/modules/news/adapters/wp-rest";
import { parseRobots, robotsAllows, setFetchImplementation } from "../src/modules/news/fetcher";
import { BASELINE_KEEP, baselineStatus, nextHealth, requestUrl, runSource } from "../src/modules/news/ingest";
import { closeNewsQueue, newsQueue } from "../src/modules/news/news.queue";
import { clip, decodeEntities, parseDate, toPlainText } from "../src/modules/news/text";
import { normalizeUrl, urlHash } from "../src/modules/news/url";
import { seedReferenceData } from "../prisma/seed/reference";
import { cleanup, createStaff, loginAs } from "./admin-helpers";
import { call } from "./helpers";

const NOW = new Date("2026-11-21T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
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
  await newsQueue().obliterate({ force: true });
  await closeNewsQueue();
});

// ---- fixtures ---------------------------------------------------------------------------

const rssFeed = (items: Array<{ title: string; link: string; date?: Date; desc?: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map(
      (i) =>
        `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link>${i.date ? `<pubDate>${i.date.toUTCString()}</pubDate>` : ""}${i.desc ? `<description><![CDATA[${i.desc}]]></description>` : ""}</item>`,
    )
    .join("")}</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Counselling schedule</title>
  <link rel="self" href="https://x.example/self"/><link rel="alternate" href="https://x.example/notice-1/?utm_source=a"/><updated>2026-11-20T08:00:00Z</updated><summary>Round 1</summary></entry></feed>`;

const WP = JSON.stringify([
  { link: "https://w.example/a/", title: { rendered: "Seat matrix &#8211; Round 1" }, date_gmt: "2026-11-20T11:39:30", excerpt: { rendered: "<p>Seats for <b>MBBS</b></p>" } },
  { link: "https://w.example/b/", title: { rendered: "" }, date_gmt: "2026-11-19T00:00:00" },
]);

/** Serves canned bodies by URL; robots.txt is a 404 unless given. Counts requests per URL. */
function fakeWeb(routes: Record<string, () => Response | string>) {
  const hits: Record<string, number> = {};
  setFetchImplementation(async (url, init) => {
    hits[url] = (hits[url] ?? 0) + 1;
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    const out = r();
    void init;
    return typeof out === "string" ? new Response(out, { status: 200, headers: { "content-type": "application/xml", etag: '"v1"' } }) : out;
  });
  return hits;
}

async function makeSource(over: Record<string, unknown> = {}) {
  return prisma.newsSource.create({
    data: { slug: `s-${Math.random().toString(36).slice(2, 8)}`, name: "Test source", kind: "RSS", listUrl: "https://feed.example/feed/", isActive: true, ...over },
  });
}

// ---- pure helpers -----------------------------------------------------------------------

describe("text and url helpers", () => {
  test("entities, tags and clipping", () => {
    expect(decodeEntities("Seat &amp; fee &#8211; round&nbsp;1 &#x2019;s &unknown;")).toBe("Seat & fee – round 1 ’s &unknown;");
    expect(toPlainText("<p>Hello <b>world</b></p><script>x()</script>&amp;")).toBe("Hello world &");
    expect(clip("one two three four five six", 15)).toBe("one two three…");
    expect(clip("short", 15)).toBe("short");
  });

  test("dates: junk and far-future dates are rejected", () => {
    expect(parseDate("2026-11-20T08:00:00Z", NOW)?.toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(parseDate("0000-00-00", NOW)).toBeNull();
    expect(parseDate("1970-01-01", NOW)).toBeNull();
    expect(parseDate("2027-06-01", NOW)).toBeNull();
    expect(parseDate("not a date", NOW)).toBeNull();
    expect(parseDate(undefined, NOW)).toBeNull();
  });

  test("normalizeUrl makes spellings of one address identical", () => {
    const a = normalizeUrl("HTTPS://Site.Example:443/Notices/?b=2&utm_source=x&a=1#top");
    expect(a).toBe("https://site.example/Notices?a=1&b=2");
    expect(normalizeUrl("/files/a.pdf", "https://site.example/page/")).toBe("https://site.example/files/a.pdf");
    expect(normalizeUrl("https://site.example/Notices?a=1&b=2")).toBe(a!);
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("  ", "https://site.example/page/")).toBeNull(); // empty must not resolve to the base
    expect(urlHash(a!)).toHaveLength(64);
  });
});

describe("robots.txt", () => {
  test("longest rule wins, allow beats disallow on a tie, no match means allowed", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/open/\nDisallow: /*.pdf$\n");
    expect(robotsAllows(rules, "/notices")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/open/x")).toBe(true);
    expect(robotsAllows(rules, "/files/a.pdf")).toBe(false);
    expect(robotsAllows(rules, "/files/a.pdf?x=1")).toBe(true);
  });

  test("our own group beats the * group; an HTML page served as robots.txt means no rules", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: BrightPathNewsBot\nDisallow: /admin\n");
    expect(robotsAllows(rules, "/notices")).toBe(true);
    expect(robotsAllows(rules, "/admin/x")).toBe(false);
    expect(parseRobots("<!doctype html><html><body>Not found</body></html>")).toEqual([]);
    expect(robotsAllows([], "/anything")).toBe(true);
  });
});

// ---- adapters ---------------------------------------------------------------------------

describe("RSS adapter", () => {
  test("reads RSS 2.0: CDATA titles, entities, dates, excerpts, relative links, skips items without a link", () => {
    const body = rssFeed([
      { title: "Round 1 &amp; mop-up &#8211; notice", link: "/n/1/?utm_medium=x", date: day(1), desc: "<p>See <b>schedule</b></p>" },
      { title: "No link item", link: "" },
      { title: "Old", link: "https://feed.example/n/2", date: day(3) },
    ]);
    const out = extractRss({ body, url: "https://feed.example/feed/", config: {}, now: NOW });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "Round 1 & mop-up – notice", url: "https://feed.example/n/1", dateBasis: "SOURCE", snippet: "See schedule" });
    expect(out[0]!.sourcePublishedAt?.toISOString()).toBe(day(1).toISOString().replace(/\.\d+Z/, ".000Z"));
    expect(out[1]!.snippet).toBeNull();
  });

  test("a missing date falls back to FIRST_SEEN", () => {
    const out = extractRss({ body: rssFeed([{ title: "Undated", link: "https://feed.example/u" }]), url: "https://feed.example/", config: {}, now: NOW });
    expect(out[0]).toMatchObject({ sourcePublishedAt: null, dateBasis: "FIRST_SEEN" });
  });

  test("reads Atom and picks the alternate link", () => {
    const out = extractRss({ body: ATOM, url: "https://x.example/atom", config: {}, now: NOW });
    expect(out).toEqual([{ title: "Counselling schedule", url: "https://x.example/notice-1", sourcePublishedAt: new Date("2026-11-20T08:00:00Z"), dateBasis: "SOURCE", snippet: "Round 1" }]);
  });

  test("rejects things that are not feeds, with a plain message", () => {
    expect(() => extractRss({ body: "<html><body>Hello</body></html>", url: "https://x/", config: {}, now: NOW })).toThrow(AdapterError);
    expect(() => extractRss({ body: "<html><body>Hello</body></html>", url: "https://x/", config: {}, now: NOW })).toThrow(/RSS or Atom/);
  });
});

describe("WordPress JSON adapter", () => {
  test("reads posts, decodes the title, treats date_gmt as UTC, skips untitled posts", () => {
    const out = extractWpRest({ body: WP, url: "https://w.example/wp-json/wp/v2/posts", config: {}, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Seat matrix – Round 1", url: "https://w.example/a", dateBasis: "SOURCE", snippet: "Seats for MBBS" });
    expect(out[0]!.sourcePublishedAt?.toISOString()).toBe("2026-11-20T11:39:30.000Z");
  });

  test("an HTML page or a non-list answer is a clear error", () => {
    expect(() => extractWpRest({ body: "<html>REST API is disabled.</html>", url: "https://w/", config: {}, now: NOW })).toThrow(/switched its API off/);
    expect(() => extractWpRest({ body: '{"code":"rest_disabled"}', url: "https://w/", config: {}, now: NOW })).toThrow(/list of posts/);
  });

  test("the API address is derived from the home page unless the source gives one", () => {
    expect(requestUrl({ kind: "WP_REST", listUrl: "https://w.example/some/page", config: {} })).toBe("https://w.example/wp-json/wp/v2/posts?per_page=30&_fields=link,title,date_gmt,excerpt");
    expect(requestUrl({ kind: "WP_REST", listUrl: "https://w.example/wp-json/wp/v2/posts?per_page=5", config: {} })).toBe("https://w.example/wp-json/wp/v2/posts?per_page=5");
    expect(requestUrl({ kind: "WP_REST", listUrl: "https://w.example/", config: { apiUrl: "https://w.example/custom" } })).toBe("https://w.example/custom");
    expect(requestUrl({ kind: "RSS", listUrl: "https://feed.example/feed/", config: {} })).toBe("https://feed.example/feed/");
  });
});

// ---- rules ------------------------------------------------------------------------------

describe("baseline and health rules", () => {
  const cand = (date: Date | null) => ({ title: "t", url: "https://x/a", sourcePublishedAt: date, dateBasis: "SOURCE" as const });

  test("only the newest notices of the last 60 days wait for review on a first read", () => {
    expect(baselineStatus(cand(day(1)), 0, NOW)).toBe("PENDING");
    expect(baselineStatus(cand(day(59)), 5, NOW)).toBe("PENDING");
    expect(baselineStatus(cand(day(61)), 5, NOW)).toBe("BASELINE");
    expect(baselineStatus(cand(day(1)), BASELINE_KEEP, NOW)).toBe("BASELINE");
    expect(baselineStatus(cand(null), 3, NOW)).toBe("PENDING");
  });

  test("health: degraded after 3 failures, broken after 10, a good run resets", () => {
    let h = { consecutiveFailures: 0, consecutiveEmptyRuns: 0, lastItemCount: 12 };
    for (let i = 1; i <= 2; i++) h = { ...h, ...nextHealth(h, { ok: false }) };
    expect(nextHealth(h, { ok: false }).status).toBe("DEGRADED");
    for (let i = 3; i <= 9; i++) h = { ...h, ...nextHealth(h, { ok: false }) };
    expect(h.consecutiveFailures).toBe(9);
    expect(nextHealth(h, { ok: false }).status).toBe("BROKEN"); // the 10th failure
    h = { ...h, ...nextHealth(h, { ok: false }) };
    expect(nextHealth(h, { ok: false }).status).toBe("BROKEN");
    expect(nextHealth(h, { ok: true, found: 5 })).toEqual({ consecutiveFailures: 0, consecutiveEmptyRuns: 0, lastItemCount: 5, status: "OK" });
  });

  test("health: a source that used to return notices and now returns none becomes BROKEN after 3 runs; one that never did does not", () => {
    let h = { consecutiveFailures: 0, consecutiveEmptyRuns: 0, lastItemCount: 8 };
    h = { ...h, ...nextHealth(h, { ok: true, found: 0 }) };
    h = { ...h, ...nextHealth(h, { ok: true, found: 0 }) };
    expect(nextHealth(h, { ok: true, found: 0 }).status).toBe("BROKEN");
    expect(nextHealth(h, { ok: true, found: 0 }).lastItemCount).toBe(8); // remembered, so the rule keeps working
    expect(nextHealth(h, { ok: true, found: 3 }).status).toBe("OK");
    expect(nextHealth({ consecutiveFailures: 0, consecutiveEmptyRuns: 0, lastItemCount: 0 }, { ok: true, found: 0 }).status).toBe("OK");
    expect(nextHealth(h, { ok: true, found: 0, notModified: true })).toMatchObject({ consecutiveEmptyRuns: 2, status: "OK" });
  });
});

// ---- a real run, with a fake network ----------------------------------------------------

describe("runSource", () => {
  const url = "https://feed.example/feed/";
  const items = (n: number, startDay = 1) => Array.from({ length: n }, (_, i) => ({ title: `Notice ${i + 1}`, link: `https://feed.example/n/${i + 1}`, date: day(startDay + i * 0.1) }));

  test("first read keeps only the newest 20 recent notices for review; the rest are baseline", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed([...items(25), { title: "Ancient", link: "https://feed.example/old", date: day(200) }]) });
    const r = await runSource(source.id, NOW);
    expect(r).toMatchObject({ outcome: "OK", itemsFound: 26, itemsNew: 26 });
    const byStatus = await prisma.newsItem.groupBy({ by: ["status"], where: { sourceId: source.id }, _count: { _all: true } });
    expect(Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]))).toEqual({ PENDING: 20, BASELINE: 6 });
    const after = await prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after).toMatchObject({ status: "OK", lastItemCount: 26, consecutiveFailures: 0, lastError: null, baselineAt: NOW, etag: '"v1"' });
    expect(await prisma.newsFetchRun.count({ where: { sourceId: source.id, outcome: "OK" } })).toBe(1);
  });

  test("a later run adds only notices it has not seen, as PENDING, and never duplicates", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed(items(3)) });
    await runSource(source.id, NOW);
    fakeWeb({ [url]: () => rssFeed([{ title: "Brand new", link: "https://feed.example/n/new", date: day(0) }, ...items(3)]) });
    const r = await runSource(source.id, NOW);
    expect(r).toMatchObject({ itemsFound: 4, itemsNew: 1 });
    expect(await prisma.newsItem.count({ where: { sourceId: source.id } })).toBe(4);
    const fresh = await prisma.newsItem.findFirstOrThrow({ where: { originalUrl: "https://feed.example/n/new" } });
    expect(fresh).toMatchObject({ status: "PENDING", dateBasis: "SOURCE", firstSeenAt: NOW });
    // same notice spelled differently on a third read is still the same notice
    fakeWeb({ [url]: () => rssFeed([{ title: "Brand new", link: "https://FEED.example/n/new/?utm_source=x", date: day(0) }]) });
    expect((await runSource(source.id, NOW)).itemsNew).toBe(0);
  });

  test("the same address listed twice in one read is stored once", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed([{ title: "A", link: "https://feed.example/a" }, { title: "A again", link: "https://feed.example/a" }]) });
    expect((await runSource(source.id, NOW)).itemsNew).toBe(1);
  });

  test("an unchanged page (304) is cheap, keeps health good and sends the stored markers", async () => {
    const source = await makeSource({ listUrl: url, etag: '"v1"', lastModified: "Fri, 20 Nov 2026 00:00:00 GMT", baselineAt: NOW, lastItemCount: 3 });
    let sent: Record<string, string> = {};
    setFetchImplementation(async (u, init) => {
      if (u.endsWith("robots.txt")) return new Response("", { status: 404 });
      sent = Object.fromEntries(Object.entries(init.headers as Record<string, string>));
      return new Response(null, { status: 304 });
    });
    const r = await runSource(source.id, NOW);
    expect(r.outcome).toBe("NOT_MODIFIED");
    expect(sent["if-none-match"]).toBe('"v1"');
    expect(sent["if-modified-since"]).toBe("Fri, 20 Nov 2026 00:00:00 GMT");
    expect(sent["user-agent"]).toContain("BrightPathNewsBot");
    const after = await prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after).toMatchObject({ status: "OK", lastSuccessAt: NOW, lastItemCount: 3 });
  });

  test("failures are recorded with a plain reason and walk the source towards DEGRADED", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => new Response("boom", { status: 503 }) });
    for (let i = 0; i < 3; i++) await runSource(source.id, NOW);
    const after = await prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after).toMatchObject({ status: "DEGRADED", consecutiveFailures: 3, lastError: "The site answered HTTP 503." });
    const run = await prisma.newsFetchRun.findFirstOrThrow({ where: { sourceId: source.id } });
    expect(run).toMatchObject({ outcome: "ERROR", httpStatus: 503 });
  });

  test("a page that is not a feed fails with the adapter's message", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => "<html><body>Maintenance</body></html>" });
    const r = await runSource(source.id, NOW);
    expect(r).toMatchObject({ outcome: "ERROR", error: "The address did not return an RSS or Atom feed." });
  });

  test("robots.txt can forbid the page: nothing is fetched, the run says why", async () => {
    const source = await makeSource({ listUrl: url });
    const hits = fakeWeb({ "https://feed.example/robots.txt": () => "User-agent: *\nDisallow: /feed/\n", [url]: () => rssFeed(items(2)) });
    const r = await runSource(source.id, NOW);
    expect(r.outcome).toBe("BLOCKED_BY_ROBOTS");
    expect(hits[url]).toBeUndefined();
    expect(await prisma.newsItem.count()).toBe(0);
  });

  test("a feed that suddenly returns nothing is flagged BROKEN after 3 empty runs", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed(items(4)) });
    await runSource(source.id, NOW);
    fakeWeb({ [url]: () => rssFeed([]) });
    for (let i = 0; i < 3; i++) await runSource(source.id, NOW);
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: "BROKEN", consecutiveEmptyRuns: 3, lastItemCount: 4 });
  });

  test("a first read that finds nothing does not use up the baseline", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed([]) });
    await runSource(source.id, NOW);
    expect((await prisma.newsSource.findUniqueOrThrow({ where: { id: source.id } })).baselineAt).toBeNull();
    fakeWeb({ [url]: () => rssFeed(items(30)) });
    await runSource(source.id, NOW);
    expect(await prisma.newsItem.count({ where: { sourceId: source.id, status: "PENDING" } })).toBe(20);
  });

  test("a later flood of new notices (site reorganised) is capped like a first read", async () => {
    const source = await makeSource({ listUrl: url });
    fakeWeb({ [url]: () => rssFeed(items(2)) });
    await runSource(source.id, NOW);
    fakeWeb({ [url]: () => rssFeed(Array.from({ length: 60 }, (_, i) => ({ title: `New ${i}`, link: `https://feed.example/new/${i}`, date: day(1 + i * 0.01) }))) });
    await runSource(source.id, NOW);
    expect(await prisma.newsItem.count({ where: { sourceId: source.id, status: "PENDING" } })).toBe(2 + 20);
    expect(await prisma.newsItem.count({ where: { sourceId: source.id, status: "BASELINE" } })).toBe(40);
  });

  test("a source of a kind with no adapter fails clearly and does not crash", async () => {
    const source = await makeSource({ kind: "HTML_LIST" });
    const r = await runSource(source.id, NOW);
    expect(r.outcome).toBe("ERROR");
    expect(r.error).toContain("cannot be read yet");
  });

  test("items carry the source's state", async () => {
    await seedReferenceData();
    const state = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const source = await makeSource({ listUrl: url, stateId: state.id });
    fakeWeb({ [url]: () => rssFeed(items(1)) });
    await runSource(source.id, NOW);
    expect((await prisma.newsItem.findFirstOrThrow({ where: { sourceId: source.id } })).stateId).toBe(state.id);
  });
});

// ---- admin API --------------------------------------------------------------------------

async function as(role: "ADMIN" | "EDITOR" | "COUNSELLOR") {
  const u = await createStaff(role);
  emails.push(u.email);
  return loginAs(u.email);
}
const body = (over: Record<string, unknown> = {}) => ({ slug: "test-feed", name: "Test feed", kind: "RSS", listUrl: "https://feed.example/feed/", ...over });
const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });

describe("admin news sources: access", () => {
  test("anonymous 401, COUNSELLOR 403, EDITOR allowed", async () => {
    const id = (await makeSource()).id;
    const routes: Array<[string, string]> = [
      ["GET", "/admin/news/sources"],
      ["GET", `/admin/news/sources/${id}`],
      ["GET", `/admin/news/sources/${id}/runs`],
    ];
    for (const [method, path] of routes) expect((await call(path, { method })).status).toBe(401);
    const counsellor = await as("COUNSELLOR");
    for (const [method, path] of routes) expect((await call(path, { method, headers: counsellor })).status).toBe(403);
    expect((await call("/admin/news/sources", { headers: await as("EDITOR") })).status).toBe(200);
  });

  test("writes need the X-BP-Admin header", async () => {
    const editor = await as("EDITOR");
    const { "x-bp-admin": _drop, ...noHeader } = editor;
    expect((await call("/admin/news/sources", { method: "POST", headers: noHeader, json: body() })).status).toBe(403);
  });
});

describe("admin news sources: registry", () => {
  test("create, read, edit, list with counts and filters, delete", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const h = await as("EDITOR");

    const created = await call("/admin/news/sources", { method: "POST", headers: h, json: body({ stateId: hp.id, notes: "  first note " }) });
    expect(created.status).toBe(201);
    const src = (created.body as any).source;
    expect(src).toMatchObject({ slug: "test-feed", isActive: false, fetchIntervalMin: 180, canFetch: true, status: "OK", notes: "first note", state: { code: "HP" }, pendingCount: 0 });
    expect(await auditCount("news-source.create")).toBe(1);

    // switching on, changing the interval, re-reading
    const patched = await call(`/admin/news/sources/${src.id}`, { method: "PATCH", headers: h, json: { isActive: true, fetchIntervalMin: 60 } });
    expect(patched.status).toBe(200);
    expect((patched.body as any).source).toMatchObject({ isActive: true, fetchIntervalMin: 60 });
    expect(await auditCount("news-source.update")).toBe(1);
    expect(((await call(`/admin/news/sources/${src.id}`, { headers: h })).body as any).source.fetchIntervalMin).toBe(60);

    // list shows counts and honours filters
    await prisma.newsItem.createMany({
      data: [
        { sourceId: src.id, title: "a", originalUrl: "https://x/a", urlHash: "a", status: "PENDING" },
        { sourceId: src.id, title: "b", originalUrl: "https://x/b", urlHash: "b", status: "BASELINE" },
      ],
    });
    await makeSource({ slug: "other", isActive: false, status: "BROKEN" });
    const all = (await call("/admin/news/sources", { headers: h })).body as any;
    expect(all.items).toHaveLength(2);
    expect(all.items[0].slug).toBe("test-feed"); // switched-on first
    expect(all.items[0]).toMatchObject({ itemCount: 2, pendingCount: 1 });
    expect(((await call("/admin/news/sources?isActive=false", { headers: h })).body as any).items.map((i: any) => i.slug)).toEqual(["other"]);
    expect(((await call("/admin/news/sources?status=BROKEN&q=oth", { headers: h })).body as any).items).toHaveLength(1);
    expect(((await call(`/admin/news/sources?stateId=${hp.id}`, { headers: h })).body as any).items).toHaveLength(1);

    // a source with stored notices cannot be deleted; an empty one can
    const refused = await call(`/admin/news/sources/${src.id}`, { method: "DELETE", headers: h });
    expect(refused.status).toBe(409);
    expect((refused.body as any).error.message).toContain("Switch it off");
    const other = (await prisma.newsSource.findFirstOrThrow({ where: { slug: "other" } })).id;
    expect((await call(`/admin/news/sources/${other}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect(await auditCount("news-source.delete")).toBe(1);
    expect((await call(`/admin/news/sources/${other}`, { headers: h })).status).toBe(404);
  });

  test("validation: slug format and uniqueness, URL, state, interval, unsupported kind cannot be switched on", async () => {
    const h = await as("EDITOR");
    expect((await call("/admin/news/sources", { method: "POST", headers: h, json: body({ slug: "Bad Slug" }) })).status).toBe(422);
    expect((await call("/admin/news/sources", { method: "POST", headers: h, json: body({ listUrl: "not a url" }) })).status).toBe(422);
    expect((await call("/admin/news/sources", { method: "POST", headers: h, json: body({ fetchIntervalMin: 5 }) })).status).toBe(422);
    const noState = await call("/admin/news/sources", { method: "POST", headers: h, json: body({ stateId: "01900000-0000-7000-8000-000000000000" }) });
    expect(noState.status).toBe(422);
    expect((noState.body as any).error.fields[0].path).toBe("stateId");

    expect((await call("/admin/news/sources", { method: "POST", headers: h, json: body() })).status).toBe(201);
    const dup = await call("/admin/news/sources", { method: "POST", headers: h, json: body() });
    expect(dup.status).toBe(422);
    expect((dup.body as any).error.fields[0].path).toBe("slug");

    const html = await call("/admin/news/sources", { method: "POST", headers: h, json: body({ slug: "html-one", kind: "HTML_LIST", isActive: true }) });
    expect(html.status).toBe(422);
    expect((html.body as any).error.fields[0].path).toBe("isActive");
    const created = await call("/admin/news/sources", { method: "POST", headers: h, json: body({ slug: "html-two", kind: "HTML_LIST" }) });
    expect(created.status).toBe(201);
    expect((created.body as any).source.canFetch).toBe(false);
    const id = (created.body as any).source.id;
    expect((await call(`/admin/news/sources/${id}`, { method: "PATCH", headers: h, json: { isActive: true } })).status).toBe(422);
    expect((await call(`/admin/news/sources/${id}`, { method: "PATCH", headers: h, json: {} })).status).toBe(422);
    expect((await call(`/admin/news/sources/${id}`, { method: "PATCH", headers: h, json: { slug: "renamed" } })).status).toBe(422);
  });

  test("changing the address clears the change markers; re-enabling gives a clean health record", async () => {
    const h = await as("EDITOR");
    const s = await makeSource({ isActive: false, status: "BROKEN", consecutiveFailures: 12, lastError: "boom", etag: '"x"', lastModified: "yesterday" });
    const r = await call(`/admin/news/sources/${s.id}`, { method: "PATCH", headers: h, json: { listUrl: "https://feed.example/new-feed/", isActive: true } });
    expect(r.status).toBe(200);
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ etag: null, lastModified: null, status: "OK", consecutiveFailures: 0, lastError: null, listUrl: "https://feed.example/new-feed/" });
  });
});

describe("admin news sources: test, run, history", () => {
  test("test shows what would be found and marks stored ones, but stores nothing and leaves health alone", async () => {
    const h = await as("EDITOR");
    const s = await makeSource({ listUrl: "https://feed.example/feed/" });
    await prisma.newsItem.create({ data: { sourceId: s.id, title: "Notice 1", originalUrl: "https://feed.example/n/1", urlHash: urlHash("https://feed.example/n/1") } });
    fakeWeb({ "https://feed.example/feed/": () => rssFeed([{ title: "Notice 1", link: "https://feed.example/n/1" }, { title: "Notice 2", link: "https://feed.example/n/2", date: day(1) }]) });
    const r = await call(`/admin/news/sources/${s.id}/test`, { method: "POST", headers: h });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, itemsFound: 2, itemsNew: 1, requestedUrl: "https://feed.example/feed/" });
    expect((r.body as any).items.map((i: any) => i.isNew)).toEqual([false, true]);
    expect(await prisma.newsItem.count()).toBe(1);
    expect(await prisma.newsFetchRun.count()).toBe(0);
    expect(await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ lastRunAt: null, baselineAt: null });
  });

  test("test reports a failing site as a normal answer with the reason", async () => {
    const h = await as("EDITOR");
    const s = await makeSource();
    fakeWeb({ "https://feed.example/feed/": () => new Response("no", { status: 500 }) });
    const r = await call(`/admin/news/sources/${s.id}/test`, { method: "POST", headers: h });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, httpStatus: 500, error: "The site answered HTTP 500.", items: [] });
  });

  test("run answers 202 and queues a job; an unsupported kind is 422; an unknown id is 404", async () => {
    const h = await as("EDITOR");
    const s = await makeSource();
    const r = await call(`/admin/news/sources/${s.id}/run`, { method: "POST", headers: h });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ queued: true });
    expect(await newsQueue().getJob(`manual-${s.id}`)).toBeTruthy();
    const html = await makeSource({ kind: "HTML_LIST", isActive: false });
    expect((await call(`/admin/news/sources/${html.id}/run`, { method: "POST", headers: h })).status).toBe(422);
    expect((await call(`/admin/news/sources/01900000-0000-7000-8000-000000000000/run`, { method: "POST", headers: h })).status).toBe(404);
  });

  test("run history lists the recent attempts newest first", async () => {
    const h = await as("EDITOR");
    const s = await makeSource({ listUrl: "https://feed.example/feed/" });
    fakeWeb({ "https://feed.example/feed/": () => rssFeed([{ title: "A", link: "https://feed.example/a" }]) });
    await runSource(s.id, NOW);
    fakeWeb({ "https://feed.example/feed/": () => new Response("x", { status: 500 }) });
    await runSource(s.id, NOW);
    const r = (await call(`/admin/news/sources/${s.id}/runs`, { headers: h })).body as any;
    expect(r.items.map((i: any) => i.outcome)).toEqual(["ERROR", "OK"]);
    expect(r.items[1]).toMatchObject({ itemsFound: 1, itemsNew: 1 });
    expect((await call(`/admin/news/sources/${s.id}/runs?limit=1`, { headers: h })).body).toMatchObject({ items: [{ outcome: "ERROR" }] });
  });
});
