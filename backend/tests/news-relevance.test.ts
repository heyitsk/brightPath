import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { setFetchImplementation } from "../src/modules/news/fetcher";
import { planStatuses, runSource } from "../src/modules/news/ingest";
import { rescoreItems } from "../src/modules/news/news.service";
import { classify, isMostlyNonLatin, titleKey } from "../src/modules/news/relevance";
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
  await prisma.siteSetting.deleteMany({ where: { key: "news.relevanceThreshold" } });
}
beforeEach(wipe);
afterEach(() => setFetchImplementation());
afterAll(async () => {
  await wipe();
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "news" } } });
  await cleanup(emails);
});

// ---- the rules, on real titles ---------------------------------------------------------------------
// Titles come from the saved pages of the official sites (some shortened). `true` = goes to the review
// queue; `false` = Filtered tab. The expectation is what a counsellor of an MBBS admissions site wants.

const KEEP_ROWS: Array<[string, string?]> = [
  ["Counselling schedule for MBBS round 1 admissions", "SCHEDULE"],
  ["Special Stray round-3 of physical counselling for admission to BDS courses", "COUNSELLING"],
  ["Provisional Selection List of candidates for admission to MBBS Courses-2026", "MERIT_LIST"],
  ["Online Registration of candidates belonging to UT of J&K/ Ladakh for admission to MBBS/BDS", "REGISTRATION"],
  ["NEET UG 2026 COUNSELLING", "COUNSELLING"],
  ["Notification regarding NEETUG 2026 Special Stray Vacancy Round Allotment List.", "RESULT"],
  ["NOTICE : SPECIAL STRAY-2 ROUND REGISTRATION FOR UG NEET- B.D.S. COURSE VACANCIES", "REGISTRATION"],
  ["SPECIAL STRAY PROVISIONAL ALLOTMENT LIST FOR UG NEET - MEDICAL / DENTAL - (2026-27)", "RESULT"],
  ["Notification regarding Special Stray Vacancy Round (Round-5) of Manipur MBBS admission"],
  ["TENTATIVE SPECIAL STRAY VACANCY ROUND II COUNSELLING SCHEDULE FOR ADMISSION TO MBBS", "SCHEDULE"],
  ["Admission Notification MBBS/BDS Courses in all Government/Government-Aided/Private Medical Colleges", "COUNSELLING"],
  ["registration for MBBS/BDS courses session 2026-27 in State of Haryana", "REGISTRATION"],
  ["Information Bulletin for NEET(UG)-2026", "OTHER"],
  ["Notice on Fake, Altered, or AI-Generated NEET (UG) 2026 Documents"],
  ["Vacant Seat Matrix for MBBS state quota seats 2026", "SEAT_MATRIX"],
  ["Establishment of New Medical Colleges for MBBS and Increase in Annual Intake Capacity of MBBS Seats", "SEAT_MATRIX"],
  ["Information Bulletin of Tripura Under Graduate Medical Counselling 2026"],
  ["NEET UG 2026 Uttarakhand State Centralized Counselling"],
  ["Corrigendum for UGMAC-2026 Round-3 Counselling (Adv. No. BCECEB(UGMAC)-2026/13)"],
  ["Public Advisory - Caution Against Unauthorised Medical Colleges and Fraudulent admission Offers"],
  ["Advisory to students, parents and the general public regarding verification of the authenticity of foreign medical colleges"],
  ["FMGE 2026 registration and counselling for foreign medical graduates"],
  ["Government order regarding Fee Structure in Believers Church Medical College", "FEE"],
  ["Notice in Continuation for the Screening of eligible candidates for (1) MBBS (2) BDS (3) BHMS (4) BAMS", "OTHER"],
  ["Counselling for MBBS and BDS Courses"],
];

const FILTER: string[] = [
  // postgraduate and super-speciality
  "Click here for Apply fresh online Application for MDS Stray Round Counselling 2026",
  "Click here for Apply fresh online Application for MD/MS/DNB Counselling 2026",
  "PG MD/MS/DNB 2nd Round Couselling Schedule 2026",
  "Important Notice Regarding Round-2 Counselling of PGMAC-2026",
  "Important Notice for Registration-cum-Choice Filling for Stray Vacancy Round of Post Graduate Dental Courses (PGDAC)-2026",
  "NOTICE : GENERAL INFORMATION FOR PG MEDICAL ROUND 1 ALLOTTED PG CANDIDATES",
  "State Level Medical PG Counselling for admission to MD, MS, Diploma Courses",
  "Publication of Updated Seat Matrix for Postgraduate (PG) Medical Courses",
  "CLICK HERE FOR RESIGNATION OF ROUND -1 PG DEGREE/DIPLOMA COURSE 2026-2027",
  "CLICK HERE FOR RESIGNATION OF ROUND -1 OF DNB BROAD SPECIALITY POST MBBS AND POST DIPLOMA",
  "Post Graduate Other Fee details for the academic year 2026-27",
  "NEET MDS 2026 Uttarakhand State Centralized Counselling",
  // AYUSH
  "Registration Process for BHMS/BAMS 2026 Round 3 has been started",
  "REVISED VACANCY AFTER 3rd ROUND BAMS/BHMS",
  "REVISED STATE QUOTA SEAT MATRIX (PG AYURVEDA 2026–27)",
  "Notice Regarding Keeping the Counselling Process for MD/MS Ayurveda Courses through AIAPGET on Hold",
  "Result of the Stray Round Counselling for Admission to 1st Year BAMS at IA Ayurveda College",
  "Important Notice for Online Application and Choice Filling for UGMAC[AYUSH]-2026 Round-3",
  // nursing, allied, paramedical
  "Notice for Extend Last date of Admission of Post Basic B.Sc and M.Sc Nursing Mop Up round 2026",
  "Retotaling Notification of B.Sc. Nursing 5th Semester Supplementary Examination",
  "Vacant Seat Matrix for GNM and ANM (R) Course at different Nursing Institute",
  "Notification regarding admission into GNM Course and ANM (R) Course for the academic year 2026-27",
  "Notification National Florence Nightingle Nurses Award 2027",
  "CHO/MLHP counselling 2026",
  "Uttarakhand Nursing Paramedical counselling 2026",
  // other courses
  "Notice - Spot Round Counselling (Degree Engg)",
  "Schedule for Second Round of PGEAC-2026 (M.Tech.)",
  "PHYSICAL STRAY COUNSELLING SCHEDULE FOR 4 VACANT SEATS IN B.A.LL.B. (5 YEARS)",
  "Notice: PGP/PGO/M.Sc.(SLP) CET 2026 Regarding Objection",
  // recruitment, administration, hospital, parliament
  "Notification - Document Verification for the Recruitment to the posts of Staff Nurse and ANM",
  "Regarding filling up of vacant posts in Directorate of Medical Education and Research",
  "Provisional Merit List for System Administrator",
  "E-Auction for the disposal of used x-ray, CT and MRI films and condemned linen",
  "Allotment of Type -IV Houses 2025",
  "RAJYA SABHA QUESTION NO. 603 DATED 03.02.2026.",
  "Opening of National Scholarship Portal",
  "Draft Prevention of Cruelty to Animals (Control and Supervision of Experiment) Rules",
  // university housekeeping
  "MCQ Objection Link for Third Professional Part-II MBBS (New Scheme) – July 2026",
  "Notice regarding Commencement of B.Pharmacy (Ayu) Examinations & Admit Cards",
  "Datesheet for various B.Pharmacy (Ayurveda) Examinations November/December 2026",
  "Notice regarding University results",
  // nothing to say
  "Public Notice for information of students, parents and other stakeholders",
  "Revision Of appeal fee in respect of appeals preferred by Medical Colleges/Institutions",
  "Gazette Notification dated 12.11.2026 of draft Administrative Regulations, 2026",
  "KEAM 2026 - Candidate Portal",
];

// Every row gets two entries, or Bun would treat the missing second one as a `done` callback.
const KEEP: Array<[string, string | null]> = KEEP_ROWS.map(([title, category]) => [title, category ?? null]);

describe("relevance rules on real titles", () => {
  test.each(KEEP)("kept: %s", (title, category) => {
    const r = classify(title);
    expect({ relevant: r.relevant, reasons: r.reasons.join(" ") }).toEqual({ relevant: true, reasons: expect.any(String) });
    if (category) expect(r.category as string).toBe(category);
  });

  test.each(FILTER.map((t) => [t]))("filtered: %s", (title) => {
    const r = classify(title);
    expect({ relevant: r.relevant, reasons: r.reasons.join(" ") }).toEqual({ relevant: false, reasons: expect.any(String) });
  });

  test("overall: about a quarter of the real titles on the saved pages are kept (guards against a rule that keeps or drops everything)", async () => {
    const { readFixture } = await import("../scripts/news-golden");
    const { HTML_SETUP } = await import("../prisma/seed/news");
    let total = 0;
    let kept = 0;
    for (const slug of Object.keys(HTML_SETUP).filter((s) => Object.keys(HTML_SETUP[s]!.config).length > 0)) {
      for (const i of readFixture(slug)) {
        total++;
        if (classify(i.title).relevant) kept++;
      }
    }
    expect(total).toBeGreaterThan(800);
    expect(kept / total).toBeGreaterThan(0.15);
    expect(kept / total).toBeLessThan(0.4);
  });
});

describe("relevance rules, one property at a time", () => {
  test("a veto beats a pile of counselling words, unless the title names MBBS or NEET UG", () => {
    const bams = classify("Stray round counselling schedule: allotment and registration for BAMS admission");
    expect(bams.score).toBeGreaterThanOrEqual(6); // plenty of counselling words, yet vetoed
    expect(bams.relevant).toBe(false);
    expect(bams.reasons).toContain("-ayush");
    const mixed = classify("NEET UG stray round counselling for MBBS, BDS and BAMS");
    expect(mixed.relevant).toBe(true);
    expect(mixed.reasons).toContain("-ayush(soft)");
  });

  test('"post MBBS" is a PG course, not an MBBS anchor', () => {
    const r = classify("Round 1 counselling for DNB (POST MBBS) 2026");
    expect(r.relevant).toBe(false);
    expect(r.reasons).toContain("-pg");
    expect(r.reasons).not.toContain("-pg(soft)");
  });

  test("recruitment and university exams are never excused, even with MBBS in the title", () => {
    expect(classify("Recruitment of MBBS medical officers on contract").relevant).toBe(false);
    expect(classify("MBBS first professional supplementary examination admit card").relevant).toBe(false);
  });

  test("a penalty counts once however often the word repeats; small words are not found inside bigger ones", () => {
    const r = classify("PG PG PG counselling for PG candidates");
    expect(r.reasons.filter((x) => x === "-pg")).toHaveLength(1);
    expect(classify("Counselling forms and arms").reasons).not.toContain("-pg"); // "ms" inside "forms", "arms"
    expect(classify("Admission to Mbbs").relevant).toBe(true);
  });

  test("the threshold decides the border; a lone 'counselling' notice is kept at the default", () => {
    expect(classify("General counselling information").relevant).toBe(true);
    expect(classify("General counselling information", { threshold: 4 }).relevant).toBe(false);
    expect(classify("Public Notice").score).toBe(0);
  });

  test("titles in Hindi, Marathi and Tamil are kept unless something recognisable says no", () => {
    expect(isMostlyNonLatin("प्रवेश वर्ष 2026 बी.एससी. नर्सिंग")).toBe(true);
    expect(isMostlyNonLatin("NEET UG counselling")).toBe(false);
    expect(classify("शैक्षणिक वर्ष २०२७-२८ करिता प्रवेश परीक्षांबाबत प्रसिद्धीपत्रक").relevant).toBe(true);
    expect(classify("एमबीबीएस काउंसलिंग कार्यक्रम 2026").relevant).toBe(true);
    expect(classify("எம்பிபிஎஸ் கலந்தாய்வு அட்டவணை 2026").relevant).toBe(true);
    expect(classify("प्रवेश वर्ष 2026 बी.एससी. नर्सिंग, एम.एससी. नर्सिंग").relevant).toBe(false);
    expect(classify("नवीन शासकीय फिजियोथेरेपी महाविद्यालयों में संविदा भर्ती").relevant).toBe(false);
  });

  test("reasons name the rules that fired, so staff can see why", () => {
    const r = classify("Counselling schedule for MBBS round 1");
    expect(r.reasons).toEqual(expect.arrayContaining(["+mbbs", "+counselling", "+schedule", "+round"]));
    expect(classify("Notice for BAMS counselling").reasons).toEqual(expect.arrayContaining(["+counselling", "-ayush"]));
  });

  test("title keys ignore case, spacing, punctuation and compatibility forms", () => {
    expect(titleKey("Seat Matrix - MBBS (2026)")).toBe(titleKey("seat matrix mbbs 2026"));
    expect(titleKey("ＮＥＥＴ ＵＧ")).toBe(titleKey("neet ug"));
    expect(titleKey("प्रवेश  वर्ष")).toBe("प्रवेशवर्ष");
    expect(titleKey("x".repeat(500))).toHaveLength(200);
  });
});

// ---- ingest: statuses, first-read limit, repeats, health records -----------------------------------------

const feedUrl = "https://feed.example/feed/";
const rssFeed = (items: Array<{ title: string; link: string; date?: Date }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link>${i.date ? `<pubDate>${i.date.toUTCString()}</pubDate>` : ""}</item>`)
    .join("")}</channel></rss>`;
const serve = (body: () => string) =>
  setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response(body(), { status: 200, headers: { "content-type": "application/xml" } })));
const makeSource = (over: Record<string, unknown> = {}) =>
  prisma.newsSource.create({ data: { slug: `s-${Math.random().toString(36).slice(2, 8)}`, name: "Src", kind: "RSS", listUrl: feedUrl, isActive: true, ...over } });

describe("ingest applies the rules", () => {
  test("notices are scored and sent to the queue or the Filtered tab, with the rules that fired", async () => {
    const s = await makeSource();
    serve(() =>
      rssFeed([
        { title: "Counselling schedule for MBBS round 2", link: "https://feed.example/a", date: day(1) },
        { title: "Counselling for MD/MS/DNB round 2", link: "https://feed.example/b", date: day(1) },
        { title: "Recruitment of staff nurses", link: "https://feed.example/c", date: day(1) },
      ]),
    );
    await runSource(s.id, NOW);
    const items = await prisma.newsItem.findMany({ where: { sourceId: s.id }, orderBy: { originalUrl: "asc" } });
    expect(items.map((i) => i.status)).toEqual(["PENDING", "FILTERED", "FILTERED"]);
    expect(items[0]).toMatchObject({ category: "SCHEDULE", titleKey: titleKey(items[0]!.title) });
    expect(items[0]!.relevanceScore).toBeGreaterThan(8);
    expect(items[0]!.relevanceReasons).toContain("+mbbs");
    expect(items[1]!.relevanceReasons).toContain("-pg");
  });

  test("the first-read limit counts relevant notices only: 25 relevant among 30 irrelevant gives 20 in the queue", async () => {
    const s = await makeSource();
    const noise = Array.from({ length: 30 }, (_, i) => ({ title: `Recruitment notice number ${i} for staff`, link: `https://feed.example/n/${i}`, date: day(1 + i * 0.01) }));
    const real = Array.from({ length: 25 }, (_, i) => ({ title: `MBBS counselling round ${i + 1} schedule`, link: `https://feed.example/r/${i}`, date: day(1 + i * 0.01) }));
    serve(() => rssFeed([...noise.slice(0, 15), ...real.slice(0, 12), ...noise.slice(15), ...real.slice(12)]));
    await runSource(s.id, NOW);
    const by = await prisma.newsItem.groupBy({ by: ["status"], where: { sourceId: s.id }, _count: { _all: true } });
    expect(Object.fromEntries(by.map((g) => [g.status, g._count._all]))).toEqual({ PENDING: 20, BASELINE: 5, FILTERED: 30 });
  });

  test("irrelevant notices older than 60 days on a first read are baseline, not clutter in the Filtered tab", () => {
    const mk = (title: string, d: number) => ({ candidate: { title, url: `https://x/${title}`, sourcePublishedAt: day(d), dateBasis: "SOURCE" as const }, index: 0 });
    const out = planStatuses([mk("Recruitment of drivers", 5), mk("Recruitment of cooks", 100), mk("MBBS counselling schedule", 5)], 3, true, NOW);
    expect(out.map((o) => o.status)).toEqual(["FILTERED", "BASELINE", "PENDING"]);
    expect(planStatuses([mk("Recruitment of cooks", 100)], 3, false, NOW)[0]!.status).toBe("FILTERED");
  });

  test("a notice with the same title as an earlier one is flagged as a repeat but still queued; works across sources and inside one batch", async () => {
    const a = await makeSource({ listUrl: feedUrl });
    const b = await makeSource({ listUrl: "https://other.example/feed/" });
    serve(() => rssFeed([{ title: "MBBS Counselling Schedule 2026", link: "https://feed.example/1", date: day(2) }]));
    await runSource(a.id, NOW);
    const original = await prisma.newsItem.findFirstOrThrow({ where: { sourceId: a.id } });
    expect(original.duplicateOfId).toBeNull();

    serve(() =>
      rssFeed([
        { title: "MBBS counselling schedule - 2026", link: "https://other.example/x", date: day(1) },
        { title: "Seat matrix for MBBS", link: "https://other.example/y", date: day(1) },
        { title: "SEAT MATRIX FOR MBBS", link: "https://other.example/z", date: day(1) },
      ]),
    );
    await runSource(b.id, NOW);
    const fromB = await prisma.newsItem.findMany({ where: { sourceId: b.id }, orderBy: { originalUrl: "asc" } });
    expect(fromB[0]).toMatchObject({ status: "PENDING", duplicateOfId: original.id });
    expect(fromB[1]!.duplicateOfId).toBeNull();
    expect(fromB[2]).toMatchObject({ status: "PENDING", duplicateOfId: fromB[1]!.id });
  });

  test("a source turning broken, and coming back, is written to the audit log once each", async () => {
    const s = await makeSource({ lastItemCount: 5, baselineAt: NOW });
    const actions = async () => (await prisma.auditLog.findMany({ where: { entityId: s.id }, orderBy: { at: "asc" } })).map((a) => a.action);
    setFetchImplementation(async (u) => (u.endsWith("robots.txt") ? new Response("", { status: 404 }) : new Response("down", { status: 503 })));
    for (let i = 0; i < 3; i++) await runSource(s.id, NOW);
    expect(await actions()).toEqual(["news-source.degraded"]);
    for (let i = 0; i < 7; i++) await runSource(s.id, NOW);
    expect(await actions()).toEqual(["news-source.degraded", "news-source.broken"]);
    serve(() => rssFeed([{ title: "MBBS counselling schedule", link: "https://feed.example/back", date: day(0) }]));
    await runSource(s.id, NOW);
    expect(await actions()).toEqual(["news-source.degraded", "news-source.broken", "news-source.recovered"]);
    const broken = await prisma.auditLog.findFirstOrThrow({ where: { action: "news-source.broken", entityId: s.id } });
    expect(broken).toMatchObject({ actorId: null, before: { status: "DEGRADED" }, after: { status: "BROKEN", consecutiveFailures: 10 } });
  });

  test("a feed that returns nothing three times in a row is recorded as broken too", async () => {
    const s = await makeSource({ lastItemCount: 5, baselineAt: NOW });
    serve(() => rssFeed([]));
    for (let i = 0; i < 3; i++) await runSource(s.id, NOW);
    expect(await prisma.auditLog.count({ where: { entityId: s.id, action: "news-source.broken" } })).toBe(1);
  });
});

// ---- re-scoring and the new routes --------------------------------------------------------------------------

describe("rescore and routes", () => {
  async function as(role: "ADMIN" | "EDITOR" | "COUNSELLOR") {
    const u = await createStaff(role);
    emails.push(u.email);
    return { headers: await loginAs(u.email), user: u.user };
  }
  const setThreshold = (value: number) => prisma.siteSetting.upsert({ where: { key: "news.relevanceThreshold" }, create: { key: "news.relevanceThreshold", value }, update: { value } });
  const item = (sourceId: string, n: number, title: string, over: Record<string, unknown> = {}) =>
    prisma.newsItem.create({ data: { sourceId, title, originalUrl: `https://x.example/${n}`, urlHash: `h${n}`, ...over } });

  test("changing the threshold and re-scoring moves waiting notices, and never touches reviewed ones", async () => {
    const s = await makeSource();
    const { user } = await as("COUNSELLOR");
    const fee = await item(s.id, 1, "Fee structure for MBBS 2026", { status: "PENDING", relevanceScore: 8 }); // score 8 under the rules
    const lone = await item(s.id, 2, "General counselling information", { status: "PENDING" });
    const reviewed = await item(s.id, 3, "General counselling information 2", { status: "PENDING", reviewedById: user.id });
    const wrongBefore = await item(s.id, 4, "Counselling for MBBS", { status: "FILTERED" }); // filtered by an older, stricter rule

    await setThreshold(4);
    const dry = await rescoreItems(null, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, threshold: 4, examined: 3, toPending: 1, toFiltered: 1 });
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: lone.id } })).status).toBe("PENDING"); // dry run saved nothing

    const done = await rescoreItems(null);
    expect(done).toMatchObject({ examined: 3, toPending: 1, toFiltered: 1 });
    const status = async (id: string) => (await prisma.newsItem.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(lone.id)).toBe("FILTERED");
    expect(await status(wrongBefore.id)).toBe("PENDING");
    expect(await status(fee.id)).toBe("PENDING");
    expect(await status(reviewed.id)).toBe("PENDING"); // reviewed by staff: untouched
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: wrongBefore.id } })).relevanceReasons).toContain("+mbbs");
  });

  test("re-scoring also fills in title keys and repeat flags on older notices", async () => {
    const s = await makeSource();
    const first = await item(s.id, 1, "MBBS Seat Matrix 2026", { status: "PENDING" });
    const second = await item(s.id, 2, "mbbs seat matrix - 2026", { status: "PENDING" });
    const r = await rescoreItems(null);
    expect(r.repeatsFlagged).toBe(1);
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: second.id } })).duplicateOfId).toBe(first.id);
    expect((await prisma.newsItem.findUniqueOrThrow({ where: { id: first.id } })).duplicateOfId).toBeNull();
    expect((await rescoreItems(null)).repeatsFlagged).toBe(0); // second run changes nothing
  });

  test("the setting exists, is private, and refuses values outside 1 to 20", async () => {
    const { headers } = await as("ADMIN");
    const all = (await call("/admin/settings", { headers })).body as any;
    const s = (all.items ?? all.settings ?? all).find((x: any) => x.key === "news.relevanceThreshold");
    expect(s).toMatchObject({ value: 3, isPublic: false, isDefault: true });
    expect((await call("/admin/settings/news.relevanceThreshold", { method: "PUT", headers, json: { value: 0 } })).status).toBe(422);
    expect((await call("/admin/settings/news.relevanceThreshold", { method: "PUT", headers, json: { value: 5 } })).status).toBe(200);
    const pub = (await call("/site/config")).text;
    expect(pub).not.toContain("relevanceThreshold");
  });

  test("POST /admin/news/relevance/test explains a title; EDITOR and ADMIN only", async () => {
    const editor = (await as("EDITOR")).headers;
    const r = await call("/admin/news/relevance/test", { method: "POST", headers: editor, json: { title: "Special stray round counselling for MBBS/BDS 2026" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ threshold: 3, relevant: true, category: "COUNSELLING" });
    expect((r.body as any).reasons).toContain("+mbbs");
    expect((await call("/admin/news/relevance/test", { method: "POST", headers: editor, json: { title: "" } })).status).toBe(422);
    expect((await call("/admin/news/relevance/test", { method: "POST", headers: (await as("COUNSELLOR")).headers, json: { title: "x" } })).status).toBe(403);
    expect((await call("/admin/news/relevance/test", { method: "POST", headers: { "x-bp-admin": "1" }, json: { title: "x" } })).status).toBe(401);
  });

  test("POST /admin/news/rescore: EDITOR runs it (audited), dry run is not audited, COUNSELLOR is refused", async () => {
    const s = await makeSource();
    await item(s.id, 1, "Counselling for MBBS", { status: "FILTERED" });
    const editor = (await as("EDITOR")).headers;
    const dry = await call("/admin/news/rescore", { method: "POST", headers: editor, json: { dryRun: true } });
    expect(dry.body).toMatchObject({ dryRun: true, examined: 1, toPending: 1 });
    expect(await prisma.auditLog.count({ where: { action: "news.rescore" } })).toBe(0);
    const real = await call("/admin/news/rescore", { method: "POST", headers: editor });
    expect(real.body).toMatchObject({ dryRun: false, changed: 1, toPending: 1 });
    expect(await prisma.auditLog.count({ where: { action: "news.rescore" } })).toBe(1);
    expect((await call("/admin/news/rescore", { method: "POST", headers: (await as("COUNSELLOR")).headers })).status).toBe(403);
  });

  test("GET /admin/news/stats is open to every staff role and counts what waits", async () => {
    await seedReferenceData();
    const hp = await prisma.state.findFirstOrThrow({ where: { code: "HP" } });
    const good = await makeSource({ stateId: hp.id });
    const bad = await makeSource({ status: "BROKEN", lastError: "The site answered HTTP 500." });
    await makeSource({ isActive: false });
    await item(good.id, 1, "MBBS counselling", { status: "PENDING", stateId: hp.id });
    await item(good.id, 2, "MBBS seat matrix", { status: "PENDING", stateId: hp.id, firstSeenAt: day(3) });
    await item(bad.id, 3, "NMC advisory", { status: "PENDING" });
    await item(bad.id, 4, "Recruitment", { status: "FILTERED" });
    await item(bad.id, 5, "Old", { status: "BASELINE" });

    expect((await call("/admin/news/stats")).status).toBe(401);
    for (const role of ["COUNSELLOR", "EDITOR", "ADMIN"] as const) expect((await call("/admin/news/stats", { headers: (await as(role)).headers })).status).toBe(200);
    const r = (await call("/admin/news/stats", { headers: (await as("COUNSELLOR")).headers })).body as any;
    expect(r.pending.total).toBe(3);
    expect(r.pending.newLast24h).toBe(2); // the item seen 3 days ago does not count
    expect(r.pending.byState).toEqual([
      { stateId: hp.id, stateName: "Himachal Pradesh", count: 2 },
      { stateId: null, stateName: null, count: 1 },
    ]);
    expect(r.filtered).toBe(1);
    expect(r.sources).toEqual({ active: 2, off: 1, ok: 1, degraded: 0, broken: 1 });
    expect(r.attention).toEqual([expect.objectContaining({ id: bad.id, status: "BROKEN", lastError: "The site answered HTTP 500." })]);
  });
});
