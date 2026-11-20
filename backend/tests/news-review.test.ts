import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { rescoreItems } from "../src/modules/news/news.service";
import { seedReferenceData } from "../prisma/seed/reference";
import { cleanup, createStaff, loginAs } from "./admin-helpers";
import { call } from "./helpers";

const emails: string[] = [];
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * 86_400_000);

async function wipe() {
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "news-item" } } });
  await prisma.newsItem.deleteMany();
  await prisma.newsFetchRun.deleteMany();
  await prisma.newsSource.deleteMany();
}
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "news" } } });
  await cleanup(emails);
});

async function as(role: "ADMIN" | "EDITOR" | "COUNSELLOR") {
  const u = await createStaff(role);
  emails.push(u.email);
  return { h: await loginAs(u.email), user: u.user };
}
const makeSource = (over: Record<string, unknown> = {}) =>
  prisma.newsSource.create({ data: { slug: `s-${Math.random().toString(36).slice(2, 8)}`, name: "Directorate of Medical Education", siteUrl: "https://dme.example/", kind: "RSS", listUrl: "https://dme.example/feed", isActive: true, ...over } });
let n = 0;
const makeItem = async (sourceId: string, title: string, over: Record<string, unknown> = {}) => {
  n++;
  return prisma.newsItem.create({ data: { sourceId, title, originalUrl: `https://dme.example/notice/${n}`, urlHash: `hash-${n}-${Math.random()}`, status: "PENDING", ...over } });
};
const SUMMARY = "Round 2 counselling for MBBS seats starts on 25 November.";
const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });
const get = async (path: string, h: Record<string, string>) => (await call(path, { headers: h })).body as any;

describe("access", () => {
  test("anonymous 401, every staff role may use the review routes, writes need X-BP-Admin", async () => {
    const s = await makeSource();
    const it = await makeItem(s.id, "MBBS counselling");
    expect((await call("/admin/news/items")).status).toBe(401);
    expect((await call(`/admin/news/items/${it.id}`)).status).toBe(401);
    for (const role of ["COUNSELLOR", "EDITOR", "ADMIN"] as const) {
      const { h } = await as(role);
      expect((await call("/admin/news/items", { headers: h })).status).toBe(200);
      expect((await call(`/admin/news/items/${it.id}`, { headers: h })).status).toBe(200);
    }
    const { h } = await as("COUNSELLOR");
    const { "x-bp-admin": _x, ...noHeader } = h;
    expect((await call(`/admin/news/items/${it.id}/reject`, { method: "POST", headers: noHeader })).status).toBe(403);
    expect((await call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: noHeader, json: { isPinned: true } })).status).toBe(403);
  });
});

describe("the review list", () => {
  test("defaults to the waiting tab, newest found first, with counts for every tab", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    const a = await makeItem(s.id, "Older notice", { firstSeenAt: ago(3) });
    const b = await makeItem(s.id, "Newer notice", { firstSeenAt: ago(1) });
    await makeItem(s.id, "Filtered one", { status: "FILTERED" });
    await makeItem(s.id, "Done one", { status: "PUBLISHED", slug: "done-one", publishedAt: new Date(), summary: SUMMARY });
    const r = await get("/admin/news/items", h);
    expect(r.items.map((i: any) => i.id)).toEqual([b.id, a.id]);
    expect(r.counts).toEqual({ PENDING: 2, FILTERED: 1, PUBLISHED: 1, REJECTED: 0, UNPUBLISHED: 0, BASELINE: 0 });
    expect(r.nextCursor).toBeNull();
    expect((await get("/admin/news/items?status=FILTERED", h)).items).toHaveLength(1);
  });

  test("filters: state, central, source, category, search, hide repeats", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const { h } = await as("COUNSELLOR");
    const s1 = await makeSource();
    const s2 = await makeSource({ name: "Other source" });
    const inHp = await makeItem(s1.id, "Seat matrix for MBBS", { stateId: hp.id, category: "SEAT_MATRIX" });
    const central = await makeItem(s2.id, "NMC advisory to students", { category: "OTHER" });
    const repeat = await makeItem(s2.id, "Seat matrix for MBBS again", { stateId: hp.id, category: "SEAT_MATRIX", duplicateOfId: inHp.id });
    const ids = async (qs: string) => (await get(`/admin/news/items?${qs}`, h)).items.map((i: any) => i.id).sort();
    expect(await ids(`stateId=${hp.id}`)).toEqual([inHp.id, repeat.id].sort());
    expect(await ids("central=true")).toEqual([central.id]);
    expect(await ids(`sourceId=${s2.id}`)).toEqual([central.id, repeat.id].sort());
    expect(await ids("category=SEAT_MATRIX")).toEqual([inHp.id, repeat.id].sort());
    expect(await ids("q=advisory")).toEqual([central.id]);
    expect(await ids("hideRepeats=true")).toEqual([inHp.id, central.id].sort());
    const counts = (await get(`/admin/news/items?stateId=${hp.id}`, h)).counts;
    expect(counts.PENDING).toBe(2); // counts follow the filters
  });

  test("paging by cursor stays correct while notices are decided in between", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    const items = [];
    for (let i = 0; i < 5; i++) items.push(await makeItem(s.id, `Notice ${i}`, { firstSeenAt: ago(i + 1) })); // 0 is newest
    const first = await get("/admin/news/items?limit=2", h);
    expect(first.items.map((i: any) => i.title)).toEqual(["Notice 0", "Notice 1"]);
    expect(first.nextCursor).toBeTruthy();
    // staff reject the two they just saw; a page-number scheme would now skip two notices
    await call("/admin/news/items/bulk", { method: "POST", headers: h, json: { ids: first.items.map((i: any) => i.id), action: "reject" } });
    const second = await get(`/admin/news/items?limit=2&cursor=${first.nextCursor}`, h);
    expect(second.items.map((i: any) => i.title)).toEqual(["Notice 2", "Notice 3"]);
    const third = await get(`/admin/news/items?limit=2&cursor=${second.nextCursor}`, h);
    expect(third.items.map((i: any) => i.title)).toEqual(["Notice 4"]);
    expect(third.nextCursor).toBeNull();
    expect((await call("/admin/news/items?cursor=garbage", { headers: h })).status).toBe(422);
  });

  test("one item shows its source, state, relevance reasons, repeat hint and who did what", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const { h, user } = await as("COUNSELLOR");
    const s = await makeSource();
    const first = await makeItem(s.id, "MBBS seat matrix", { status: "PUBLISHED" });
    const it = await makeItem(s.id, "MBBS seat matrix 2", { stateId: hp.id, relevanceScore: 8, relevanceReasons: ["+mbbs", "+seat-matrix"], duplicateOfId: first.id, reviewedById: user.id, reviewedAt: new Date() });
    const r = (await get(`/admin/news/items/${it.id}`, h)).item;
    expect(r).toMatchObject({
      status: "PENDING",
      state: { code: "HP" },
      source: { name: "Directorate of Medical Education", siteUrl: "https://dme.example/" },
      relevance: { score: 8, reasons: ["+mbbs", "+seat-matrix"] },
      duplicateOf: { id: first.id, title: "MBBS seat matrix", status: "PUBLISHED" },
      reviewedBy: { id: user.id, name: "Test COUNSELLOR" },
      publishedBy: null,
    });
    expect((await call("/admin/news/items/01900000-0000-7000-8000-000000000000", { headers: h })).status).toBe(404);
  });
});

describe("editing", () => {
  test("edits the wording, category, state and pin; counts as a review; checks its inputs", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const { h, user } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "click here for MBBS NOTICE 2026 (pdf 0.5 MB)");
    const r = await call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: h, json: { publicTitle: "  MBBS notice 2026  ", summary: SUMMARY, category: "SCHEDULE", stateId: hp.id, isPinned: true } });
    expect(r.status).toBe(200);
    expect((r.body as any).item).toMatchObject({ publicTitle: "MBBS notice 2026", summary: SUMMARY, category: "SCHEDULE", isPinned: true, state: { code: "HP" }, status: "PENDING", reviewedBy: { id: user.id } });
    expect(await auditCount("news-item.update")).toBe(1);

    const patch = (json: unknown) => call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: h, json });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ summary: "short" })).status).toBe(422);
    const noState = await patch({ stateId: "01900000-0000-7000-8000-000000000000" });
    expect(noState.status).toBe(422);
    expect((noState.body as any).error.fields[0].path).toBe("stateId");
    expect((await patch({ category: "NONSENSE" })).status).toBe(422);
    expect(((await patch({ publicTitle: null })).body as any).item.publicTitle).toBeNull();
  });

  test("an edited notice is left alone by re-scoring", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "General counselling information", { status: "FILTERED" });
    await call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: h, json: { isPinned: false } });
    const r = await rescoreItems(null);
    expect(r.examined).toBe(0);
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: it.id } })).status).toBe("FILTERED");
  });
});

describe("publishing", () => {
  test("a summary is required; with one, the notice goes live with a slug from its public title and an audit entry", async () => {
    const { h, user } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "Notice regarding MBBS counselling schedule 2026");
    const none = await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h });
    expect(none.status).toBe(422);
    expect((none.body as any).error.fields[0]).toMatchObject({ path: "summary" });
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: it.id } })).status).toBe("PENDING");

    const ok = await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY, publicTitle: "MBBS counselling schedule 2026" } });
    expect(ok.status).toBe(200);
    const item = (ok.body as any).item;
    expect(item).toMatchObject({ status: "PUBLISHED", slug: "mbbs-counselling-schedule-2026", publicTitle: "MBBS counselling schedule 2026", publishedBy: { id: user.id }, reviewedBy: { id: user.id } });
    expect(item.publishedAt).toBeTruthy();
    expect(await auditCount("news-item.publish")).toBe(1);

    expect((await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY } })).status).toBe(409);
  });

  test("a summary saved earlier is enough; the body can fix the title at the same time", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "Seat matrix MBBS", { summary: SUMMARY });
    const r = await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: {} });
    expect(r.status).toBe(200);
    expect((r.body as any).item.slug).toBe("seat-matrix-mbbs");
  });

  test("two notices with the same title get different addresses; a title with no Latin letters gets a fallback; unpublishing and republishing keeps the address", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    const a = await makeItem(s.id, "MBBS counselling schedule");
    const b = await makeItem(s.id, "MBBS counselling schedule");
    const hindi = await makeItem(s.id, "एमबीबीएस काउंसलिंग कार्यक्रम");
    const pub = async (id: string) => ((await call(`/admin/news/items/${id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY } })).body as any).item;
    expect((await pub(a.id)).slug).toBe("mbbs-counselling-schedule");
    expect((await pub(b.id)).slug).toBe("mbbs-counselling-schedule-2");
    expect((await pub(hindi.id)).slug).toMatch(/^notice-[0-9a-f]{8}$/);
    await call(`/admin/news/items/${a.id}/unpublish`, { method: "POST", headers: h });
    expect((await pub(a.id)).slug).toBe("mbbs-counselling-schedule");
  });

  test("a filtered, rejected or older notice can be published directly", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    for (const status of ["FILTERED", "REJECTED", "BASELINE", "UNPUBLISHED"] as const) {
      const it = await makeItem(s.id, `Notice ${status}`, { status });
      expect((await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY } })).status).toBe(200);
    }
  });

  test("editing a published notice is live at once, moves 'checked on', and cannot remove its summary", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "MBBS fee notice");
    await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY } });
    await prisma.newsItem.update({ where: { id: it.id }, data: { reviewedAt: ago(10) } });
    expect((await call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: h, json: { summary: null } })).status).toBe(422);
    expect((await call(`/admin/news/items/${it.id}`, { method: "PATCH", headers: h, json: { summary: "A better, corrected summary of the notice." } })).status).toBe(200);
    const live = (await get("/news/mbbs-fee-notice", {})).news;
    expect(live.summary).toBe("A better, corrected summary of the notice.");
    expect(live.checkedOn).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("rejecting, unpublishing, restoring", () => {
  test("each action moves the notice and refuses the wrong starting point with a plain reason", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "MBBS notice", { summary: SUMMARY });
    const act = (a: string, json?: unknown) => call(`/admin/news/items/${it.id}/${a}`, { method: "POST", headers: h, json });
    const status = async () => (await prisma.newsItem.findUniqueOrThrow({ where: { id: it.id } })).status;

    expect((await act("unpublish")).status).toBe(409); // not published
    expect((await act("restore")).status).toBe(409); // already waiting
    expect((await act("reject", { note: "not about admissions" })).status).toBe(200);
    expect(await status()).toBe("REJECTED");
    expect((await act("reject")).status).toBe(409); // already rejected
    expect((await act("restore")).status).toBe(200);
    expect(await status()).toBe("PENDING");
    expect((await act("publish", { summary: SUMMARY })).status).toBe(200);
    const refused = await act("reject");
    expect(refused.status).toBe(409);
    expect((refused.body as any).error.message).toContain("unpublished");
    expect((await act("restore")).status).toBe(409); // published
    expect((await act("unpublish")).status).toBe(200);
    expect(await status()).toBe("UNPUBLISHED");
    expect((await act("restore")).status).toBe(200);
    expect(await auditCount("news-item.reject")).toBe(1);
    expect(await auditCount("news-item.restore")).toBe(2);
    expect(await auditCount("news-item.unpublish")).toBe(1);
    const rejectAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "news-item.reject" } });
    expect(rejectAudit.after).toMatchObject({ status: "REJECTED", note: "not about admissions" });
  });

  test("a restored notice stays in the queue when the rules are re-run", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await makeItem((await makeSource()).id, "Recruitment of drivers", { status: "FILTERED" });
    await call(`/admin/news/items/${it.id}/restore`, { method: "POST", headers: h });
    await rescoreItems(null);
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: it.id } })).status).toBe("PENDING");
  });

  test("bulk reject and restore: eligible ones move, the others are listed with the reason", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    const waiting = await makeItem(s.id, "Waiting one");
    const filtered = await makeItem(s.id, "Filtered one", { status: "FILTERED" });
    const live = await makeItem(s.id, "Live one", { status: "PUBLISHED", slug: "live-one", summary: SUMMARY, publishedAt: new Date() });
    const ghost = "01900000-0000-7000-8000-000000000000";
    const r = await call("/admin/news/items/bulk", { method: "POST", headers: h, json: { ids: [waiting.id, filtered.id, live.id, ghost, waiting.id], action: "reject" } });
    expect(r.status).toBe(200);
    expect((r.body as any).updated).toBe(2);
    expect((r.body as any).skipped).toEqual([
      { id: live.id, reason: expect.stringContaining("published") },
      { id: ghost, reason: "Not found." },
    ]);
    expect(await auditCount("news-item.reject")).toBe(2);
    const back = await call("/admin/news/items/bulk", { method: "POST", headers: h, json: { ids: [waiting.id, filtered.id], action: "restore" } });
    expect((back.body as any).updated).toBe(2);
    expect((await call("/admin/news/items/bulk", { method: "POST", headers: h, json: { ids: [waiting.id], action: "publish" } })).status).toBe(422);
    expect((await call("/admin/news/items/bulk", { method: "POST", headers: h, json: { ids: [], action: "reject" } })).status).toBe(422);
  });
});

describe("the public News page", () => {
  async function publish(h: Record<string, string>, sourceId: string, title: string, json: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
    const it = await makeItem(sourceId, title, over);
    const r = await call(`/admin/news/items/${it.id}/publish`, { method: "POST", headers: h, json: { summary: SUMMARY, ...json } });
    expect(r.status).toBe(200);
    return (r.body as any).item;
  }

  test("lists only published notices: pinned first, then newest published; nothing internal leaks", async () => {
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    await makeItem(s.id, "Still waiting for review");
    await makeItem(s.id, "Rejected one", { status: "REJECTED" });
    const old = await publish(h, s.id, "Old notice about MBBS", {}, { sourcePublishedAt: ago(5) });
    await prisma.newsItem.update({ where: { id: old.id }, data: { publishedAt: ago(5) } });
    const fresh = await publish(h, s.id, "Fresh notice about MBBS", { publicTitle: "Fresh MBBS notice" }, { sourcePublishedAt: ago(1), dateBasis: "SOURCE" });
    const pinned = await publish(h, s.id, "Pinned notice about NEET", { isPinned: true });
    await prisma.newsItem.update({ where: { id: pinned.id }, data: { publishedAt: ago(9) } });

    const r = await call("/news");
    expect(r.status).toBe(200);
    const body = r.body as any;
    expect(body.items.map((i: any) => i.title)).toEqual(["Pinned notice about NEET", "Fresh MBBS notice", "Old notice about MBBS"]);
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    const one = body.items[1];
    expect(one).toMatchObject({
      slug: expect.any(String),
      summary: SUMMARY,
      isPinned: false,
      source: { name: "Directorate of Medical Education", siteUrl: "https://dme.example/" },
      originalUrl: fresh.originalUrl,
      dateBasis: "SOURCE",
      sourcePublishedOn: ago(1).toISOString().slice(0, 10),
      checkedOn: new Date().toISOString().slice(0, 10),
    });
    // nothing staff-only is visible to the public
    const text = r.text;
    for (const secret of ["relevance", "reviewedBy", "publishedBy", "firstSeenAt", "urlHash", "titleKey", "duplicateOf", "status", "Still waiting", "Rejected one", `"id"`]) expect(text).not.toContain(secret);
  });

  test("filters, facets, paging and the 'added on' date basis", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const tn = await prisma.state.findFirstOrThrow({ where: { code: "TN" } });
    const { h } = await as("COUNSELLOR");
    const s = await makeSource();
    await publish(h, s.id, "Seat matrix for MBBS in Himachal", { stateId: hp.id, category: "SEAT_MATRIX" });
    await publish(h, s.id, "Counselling schedule Himachal", { stateId: hp.id, category: "SCHEDULE" });
    await publish(h, s.id, "Merit list Tamil Nadu", { stateId: tn.id, category: "MERIT_LIST" });
    await publish(h, s.id, "NMC advisory on foreign colleges", { category: "OTHER" }, { dateBasis: "FIRST_SEEN" });

    const titles = async (qs: string) => ((await call(`/news?${qs}`)).body as any).items.map((i: any) => i.title).sort();
    expect(await titles("state=himachal-pradesh")).toEqual(["Counselling schedule Himachal", "Seat matrix for MBBS in Himachal"]);
    expect(await titles("central=true")).toEqual(["NMC advisory on foreign colleges"]);
    expect(await titles("category=MERIT_LIST")).toEqual(["Merit list Tamil Nadu"]);
    expect(await titles("q=foreign")).toEqual(["NMC advisory on foreign colleges"]);
    expect(await titles("state=nowhere")).toEqual([]);

    const f = ((await call("/news?state=himachal-pradesh")).body as any).facets;
    expect(f.states).toEqual([{ slug: "himachal-pradesh", name: "Himachal Pradesh", count: 2 }, { slug: "tamil-nadu", name: "Tamil Nadu", count: 1 }]); // other states stay visible
    expect(f.centralCount).toBe(1);
    expect(f.categories.map((c: any) => c.category).sort()).toEqual(["SCHEDULE", "SEAT_MATRIX"]); // counted within the chosen state

    const p1 = (await call("/news?pageSize=3&page=1")).body as any;
    const p2 = (await call("/news?pageSize=3&page=2")).body as any;
    expect([p1.items.length, p2.items.length, p1.total]).toEqual([3, 1, 4]);
    expect(((await call("/news?q=advisory")).body as any).items[0]).toMatchObject({ dateBasis: "FIRST_SEEN", sourcePublishedOn: null });
    expect((await call("/news?pageSize=0")).status).toBe(422);
    expect((await call("/news?category=BOGUS")).status).toBe(422);
  });

  test("one notice by address; gone as soon as it is unpublished; unknown and unpublished look the same", async () => {
    const { h } = await as("COUNSELLOR");
    const it = await publish(h, (await makeSource()).id, "MBBS fee structure 2026");
    const r = await call(`/news/${it.slug}`);
    expect(r.status).toBe(200);
    expect((r.body as any).news).toMatchObject({ slug: it.slug, title: "MBBS fee structure 2026", summary: SUMMARY });
    await call(`/admin/news/items/${it.id}/unpublish`, { method: "POST", headers: h });
    const gone = await call(`/news/${it.slug}`);
    const never = await call("/news/never-existed");
    expect([gone.status, never.status]).toEqual([404, 404]);
    expect((gone.body as any).error.message).toBe((never.body as any).error.message);
    expect(((await call("/news")).body as any).total).toBe(0);
    expect((await call("/news/Bad Slug!")).status).toBe(422);
  });

  test("answers 304 for an unchanged list and carries cache headers", async () => {
    const { h } = await as("COUNSELLOR");
    await publish(h, (await makeSource()).id, "MBBS notice");
    const first = await call("/news");
    const etag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).toContain("max-age=60");
    expect(etag).toBeTruthy();
    expect((await call("/news", { headers: { "if-none-match": etag } })).status).toBe(304);
    await publish(h, (await makeSource()).id, "Another MBBS notice");
    expect((await call("/news", { headers: { "if-none-match": etag } })).status).toBe(200);
  });
});
