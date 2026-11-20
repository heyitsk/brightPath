import type { NewsSourceKind } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/prisma";

// The official sites the owner asked to watch (plan §15, history D-132 to D-143).
// Inserts only what is missing (matched by slug): sources staff have since edited are left alone,
// so re-running the seed is safe. Needs the states from the reference seed.
//
// A source is switched on only when it can be read: a feed, or an HTML site with settings (HTML_SETUP below).
// The rest are listed so staff can see them, but stay off (JavaScript pages: step N5).

type SourceSeed = {
  slug: string;
  name: string;
  /** State code from the reference seed; omit for a central body. */
  state?: string;
  kind: NewsSourceKind;
  listUrl: string;
  siteUrl: string;
  active?: boolean;
  notes?: string;
};

const N2 = "Waiting for the HTML adapter (step N2).";
const N5 = "Cannot be read as a plain page: see the notes added in step N5 (backendPlan.md section 15.12).";

export const NEWS_SOURCES: SourceSeed[] = [
  // ---- sources with a working feed that carries real notices ----
  { slug: "himachal-amru", name: "Atal Medical and Research University, Himachal Pradesh", state: "HP", kind: "RSS", listUrl: "https://amruhp.ac.in/feed/", siteUrl: "https://amruhp.ac.in/", active: true, notes: "WordPress feed; the JSON API at /wp-json/wp/v2/posts also works." },
  { slug: "telangana-knruhs", name: "KNR University of Health Sciences, Telangana", state: "TS", kind: "RSS", listUrl: "https://www.knruhs.telangana.gov.in/feed/", siteUrl: "https://www.knruhs.telangana.gov.in/", active: false, notes: "The feed works but lists site pages (\"Physiotherapy\", \"Hello world!\"), not notices, so it is off. Notices are on the site itself: needs the HTML adapter (step N2)." },

  // ---- HTML lists (step N2) ----
  { slug: "andhra-drntr", name: "Dr NTR University of Health Sciences, Andhra Pradesh", state: "AP", kind: "HTML_LIST", listUrl: "https://drntr.uhsap.in/index/", siteUrl: "https://drntr.uhsap.in/", notes: `${N2} About 140 notice links, mostly PDFs, mixed with PG.` },
  { slug: "andhra-apdhte", name: "AP Directorate of Higher Education / Technical Education", state: "AP", kind: "HTML_LIST", listUrl: "https://apdhte.nic.in/", siteUrl: "https://apdhte.nic.in/", notes: N2 },
  { slug: "assam-dme", name: "Directorate of Medical Education, Assam", state: "AS", kind: "HTML_LIST", listUrl: "https://dme.assam.gov.in/", siteUrl: "https://dme.assam.gov.in/", notes: `${N2} Drupal site.` },
  { slug: "bihar-bceceb", name: "Bihar Combined Entrance Competitive Examination Board", state: "BR", kind: "HTML_LIST", listUrl: "https://bceceboard.bihar.gov.in/", siteUrl: "https://bceceboard.bihar.gov.in/", notes: `${N2} Very long list (about 380 PDFs); the first-read limit applies.` },
  { slug: "chandigarh-gmch", name: "Government Medical College and Hospital, Chandigarh", state: "CH", kind: "HTML_LIST", listUrl: "https://gmch.gov.in/", siteUrl: "https://gmch.gov.in/", notes: `${N2} State assumed from the domain; confirm with the owner.` },
  { slug: "chhattisgarh-dme", name: "Directorate of Medical Education, Chhattisgarh", state: "CG", kind: "HTML_LIST", listUrl: "https://cgdme.in/", siteUrl: "https://cgdme.in/", notes: N2 },
  { slug: "goa-dte", name: "Directorate of Technical Education, Goa", state: "GA", kind: "HTML_LIST", listUrl: "https://dte.goa.gov.in/", siteUrl: "https://dte.goa.gov.in/", notes: `${N2} Drupal site.` },
  { slug: "haryana-dmer", name: "Directorate of Medical Education and Research, Haryana", state: "HR", kind: "HTML_LIST", listUrl: "https://dmer.haryana.gov.in/", siteUrl: "https://dmer.haryana.gov.in/", notes: N2 },
  { slug: "jk-bopee", name: "J&K Board of Professional Entrance Examinations", state: "JK", kind: "HTML_LIST", listUrl: "https://jkbopee.gov.in/", siteUrl: "https://jkbopee.gov.in/", notes: N2 },
  { slug: "jharkhand-jceceb", name: "Jharkhand Combined Entrance Competitive Examination Board", state: "JH", kind: "HTML_LIST", listUrl: "https://jceceb.jharkhand.gov.in/", siteUrl: "https://jceceb.jharkhand.gov.in/", notes: N2 },
  { slug: "kerala-cee", name: "Commissioner for Entrance Examinations, Kerala", state: "KL", kind: "HTML_LIST", listUrl: "https://cee.kerala.gov.in/", siteUrl: "https://cee.kerala.gov.in/", notes: N2 },
  { slug: "maharashtra-cet-cell", name: "State Common Entrance Test Cell, Maharashtra", state: "MH", kind: "HTML_LIST", listUrl: "https://cetcell.mahacet.org/", siteUrl: "https://cetcell.mahacet.org/", notes: `${N2} Its /feed/ is valid but empty (0 items), so the notices must be read from the page.` },
  { slug: "manipur-health", name: "Directorate of Health Services, Manipur", state: "MN", kind: "HTML_LIST", listUrl: "https://manipurhealthdirectorate.mn.gov.in/", siteUrl: "https://manipurhealthdirectorate.mn.gov.in/", notes: N2 },
  { slug: "meghalaya-health", name: "Health and Family Welfare Department, Meghalaya", state: "ML", kind: "HTML_LIST", listUrl: "https://meghealth.gov.in/", siteUrl: "https://meghealth.gov.in/", notes: `${N2} Mixes recruitment notices with admissions.` },
  { slug: "odisha-ojee", name: "Odisha Joint Entrance Examination", state: "OD", kind: "HTML_LIST", listUrl: "https://ojee.nic.in/", siteUrl: "https://ojee.nic.in/", notes: `${N2} WordPress with its JSON API and feed switched off.` },
  { slug: "puducherry-centac", name: "CENTAC Puducherry", state: "PY", kind: "HTML_LIST", listUrl: "https://centacpuducherry.in/", siteUrl: "https://centacpuducherry.in/", notes: `${N2} More than 1,000 dated links on one page; the first-read limit matters here.` },
  { slug: "tamilnadu-selection", name: "Selection Committee, Tamil Nadu Medical Admissions", state: "TN", kind: "HTML_LIST", listUrl: "https://tnmedicalselection.net/", siteUrl: "https://tnmedicalselection.net/", notes: `${N2} Bilingual (Tamil and English) titles.` },
  { slug: "tripura-dme", name: "Directorate of Medical Education, Tripura", state: "TR", kind: "HTML_LIST", listUrl: "https://dme.tripura.gov.in/", siteUrl: "https://dme.tripura.gov.in/", notes: `${N2} Drupal 9 site.` },
  { slug: "up-neet", name: "UP NEET Counselling", state: "UP", kind: "HTML_LIST", listUrl: "https://upneet.gov.in/", siteUrl: "https://upneet.gov.in/", notes: N2 },
  { slug: "uttarakhand-hnbumu", name: "Hemvati Nandan Bahuguna Uttarakhand Medical Education University", state: "UK", kind: "HTML_LIST", listUrl: "https://hnbumu.ac.in/", siteUrl: "https://hnbumu.ac.in/", notes: N2 },
  { slug: "westbengal-wbmcc", name: "West Bengal Medical Counselling Committee", state: "WB", kind: "HTML_LIST", listUrl: "https://wbmcc.nic.in/", siteUrl: "https://wbmcc.nic.in/", notes: `${N2} WordPress with its JSON API and feed switched off.` },

  // ---- central bodies (no state) ----
  { slug: "central-mcc", name: "Medical Counselling Committee (MCC)", kind: "HTML_LIST", listUrl: "https://mcc.nic.in/", siteUrl: "https://mcc.nic.in/", notes: `${N2} WordPress with its JSON API and feed switched off.` },
  { slug: "central-nta-neet", name: "NTA NEET (UG)", kind: "HTML_LIST", listUrl: "https://neet.nta.nic.in/", siteUrl: "https://neet.nta.nic.in/", notes: `${N2} The best-structured of all: about 49 notice links, 43 PDFs, about half carrying dates.` },
  { slug: "central-nmc", name: "National Medical Commission", kind: "HTML_LIST", listUrl: "https://nmc.org.in/", siteUrl: "https://nmc.org.in/", notes: `${N2} Not WordPress; no feed.` },

  // ---- JavaScript pages (step N5) ----
  { slug: "gujarat-medadm", name: "Medical Admission Committee, Gujarat", state: "GJ", kind: "HTML_JS", listUrl: "https://medadmgujarat.org/", siteUrl: "https://medadmgujarat.org/", notes: N5 },
  { slug: "mp-dme", name: "Directorate of Medical Education, Madhya Pradesh", state: "MP", kind: "HTML_JS", listUrl: "https://dme.mponline.gov.in/", siteUrl: "https://dme.mponline.gov.in/", notes: N5 },
  { slug: "mizoram-mc", name: "Medical Counselling, Mizoram", state: "MZ", kind: "HTML_JS", listUrl: "https://mc.mizoram.gov.in/", siteUrl: "https://mc.mizoram.gov.in/", notes: N5 },
  { slug: "punjab-bfuhs", name: "Baba Farid University of Health Sciences, Punjab", state: "PB", kind: "HTML_JS", listUrl: "https://bfuhs.ac.in/", siteUrl: "https://bfuhs.ac.in/", notes: N5 },
  { slug: "rajasthan-dme", name: "Department of Medical Education, Rajasthan", state: "RJ", kind: "HTML_JS", listUrl: "https://medicaleducation.rajasthan.gov.in/home", siteUrl: "https://medicaleducation.rajasthan.gov.in/", notes: `${N5} Replaces education.rajasthan.gov.in, which failed on old TLS.` },

  // ---- waiting on the site itself ----
  { slug: "karnataka-kea", name: "Karnataka Examinations Authority", state: "KA", kind: "HTML_LIST", listUrl: "https://kea.kar.nic.in/", siteUrl: "https://kea.kar.nic.in/", notes: `The site is under maintenance (owner, 2026-11-21); it timed out in testing. Re-test, then ${N2.toLowerCase()}` },
];

/**
 * How to read each HTML site (step N2): where on the page the notices are, and the oddities of that
 * site. Worked out from the real pages on 2026-11-21 and checked by the saved-page tests
 * (`tests/news-html.test.ts`). `scope` is a CSS selector; see `adapters/html-list.ts` for every setting.
 * Staff can change any of this later in the admin screen; the seed never overwrites an edited source.
 */
type HtmlSetup = { listUrl?: string; kind?: NewsSourceKind; config: Record<string, unknown>; active?: boolean; notes: string };

const READ = (what: string) => `Read from the page (${what}). Not every notice is relevant: the relevance rules come in step N4.`;

export const HTML_SETUP: Record<string, HtmlSetup> = {
  "bihar-bceceb": { config: { scope: "#marquee_replacement", row: "li", maxItems: 150 }, notes: READ("the scrolling notice list; every row has a date; PG and dental notices are mixed in") },
  "haryana-dmer": { config: { scope: "ul.demo1", maxItems: 150, allowInsecureTls: true }, notes: READ("the notice list; every row has a date; also lists scholarships and recruitment") + " The site's certificate chain is incomplete, so reading it without certificate checks is switched on for this source only." },
  "jharkhand-jceceb": { config: { scope: ".chat-widget-main", row: "div.chat-widget-right" }, notes: READ("the Important Notice panel; the date is inside the title") },
  "jk-bopee": { config: { scope: "div.news-track" }, notes: READ("the news ticker; every row has a date") },
  "puducherry-centac": { config: { scope: "#nav-overall_news-home", maxItems: 60 }, notes: READ("the Overall News tab, newest 60 of over 1,000; titles start with [dd-mm-yyyy]; PG and UG are mixed") },
  "central-nmc": { config: { scope: "div.notice-scroll-full" }, notes: READ("the What's New box; titles start with dd/mm/yyyy") },
  "chhattisgarh-dme": { config: { scope: "#page-title" }, notes: READ("the notice strip; Hindi and English titles; the page shows today's date beside every link, so dates are only taken where unambiguous") },
  "andhra-drntr": { config: { scope: "div.row.py-5", maxItems: 150 }, notes: READ("the notification lists; mostly PDFs without dates; PG, nursing and recruitment are mixed in") },
  "andhra-apdhte": { config: { scope: "table", maxItems: 100, allowInsecureTls: true }, notes: READ("the tables of circulars and allotments; mostly engineering counselling") + " The site's certificate has expired, so reading it without certificate checks is switched on for this source only." },
  "kerala-cee": { config: { scope: "div.ms-2" }, notes: READ("the notices box; no dates on the page") },
  "goa-dte": { config: { scope: "div.view-content" }, notes: READ("the latest notices list; no dates on the page") },
  "manipur-health": { config: { scope: "div.row", skipText: ["screen reader", "skip to", "sitemap", "accessib"] }, notes: READ("the news list; no dates on the page") },
  "meghalaya-health": { config: { scope: "li", onlyHref: ["/news/"], dateFromUrl: "(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})-" }, notes: READ("only links into /news/; the date is the start of the file name; mostly recruitment") },
  "odisha-ojee": { config: { scope: "ul.slides" }, notes: READ("the latest-news slider; no dates on the page; mostly AYUSH") },
  "tamilnadu-selection": { config: { scope: "#notification", maxItems: 100 }, notes: READ("the notification list; about a third of rows carry dates; Tamil and English titles") },
  "tripura-dme": { listUrl: "https://dme.tripura.gov.in/notification", config: { scope: "table" }, notes: READ("the Notifications page (not the home page); no dates on the page; nursing and PG are mixed in") },
  "uttarakhand-hnbumu": { config: { scope: "table", maxItems: 100 }, notes: READ("the notices tables; no dates on the page; mostly university matters") },
  "central-nta-neet": { config: { scope: "div.gen-list" }, active: false, notes: READ("the public notices tabs; about half the titles carry a date") + " OFF: the site answers our bot with HTTP 403 (a normal browser is let in). We identify ourselves honestly and do not pretend to be a browser, so this needs NTA's permission or a different route." },
  "maharashtra-cet-cell": { listUrl: "https://cetcell.mahacet.org/notices/", config: { scope: "table", row: "tr", titleSelector: 'td[data-column="Subject"]', dateSelector: 'td[data-column="Date"]' }, notes: READ("the Notices page (not the home page): a table with subject and date columns; mostly engineering and other CETs") },
  "chandigarh-gmch": { listUrl: "https://gmch.gov.in/public-notices", config: { scope: "table" }, notes: READ("the Public Notices page; mostly hospital matters, so most of it will be filtered out in N4") },

  // ---- step N5: sites built by JavaScript. Looking at what they really load showed that most need no browser. ----
  "westbengal-wbmcc": { kind: "HTML_LIST", listUrl: "https://wbmcc.nic.in/ug-medical-dental-counselling/", config: { scope: "#wpb-content-root" }, notes: READ("the UG Medical and Dental counselling page (the home page lists none); schedules, provisional lists by round, urgent notices with dates in the title") },
  "gujarat-medadm": { kind: "HTML_LIST", listUrl: "https://medadmgujarat.org/ug/home.aspx", config: { scope: "div.post", maxItems: 100 }, notes: READ("the UG Medical and Dental page (the home page is only a menu); newest round first; no dates on the page") },
  "up-neet": {
    kind: "HTML_LIST",
    listUrl: "https://upneet.gov.in/",
    config: { scope: "#tickerTrack", postbackLinks: true, maxItems: 100, allowInsecureTls: true },
    notes: READ("the notice ticker on the home page, newest first; UG and PG mixed; no dates") + " Each notice opens through a postback button, so it has no address of its own: the link goes to the official counselling home page (with `?notice=` added), where the notice is in the ticker and under Notifications. The site's certificate chain is incomplete, so reading it without certificate checks is switched on for this source (the same trade-off as the two sites in plan section 15.6).",
  },
  "rajasthan-dme": {
    kind: "JSON_LIST",
    listUrl: "https://medicalportal.rajasthan.gov.in/webapi/api/Sectoral/GetLatestUpdateAndReleaseListBySectoralDept?SectoralDeptCode=964",
    config: { itemsPath: "Data.LatestUpdateList", titlePath: "Achievement", urlTemplate: "https://medicaleducation.rajasthan.gov.in/order/detail/964/0/{Id}", datePath: "AchievementDate" },
    notes: "Read from the data the department's page loads (the page itself is built by JavaScript): its five latest updates, with dates. Mostly staff and recruitment matters, so most will be filtered. Found with `bun run news:discover`.",
  },

  // ---- looked at in step N5 and cannot be read (2026-11-21). Details in backendPlan.md section 15.12 ----
  "central-mcc": { kind: "HTML_JS", config: {}, active: false, notes: "OFF: the site answers our bot with HTTP 403 on every page, even robots.txt (a normal browser is let in). We identify ourselves honestly and do not pretend to be a browser, so reading it needs MCC's permission. Same reason as NTA. MCC results are in any case followed by the state sites." },
  "assam-dme": { kind: "HTML_JS", config: {}, active: false, notes: "OFF: its notice page (/document-details/admission-notices-orders-0) is a plain table, but it is an archive: the newest file is from 2022, so there is nothing current to read. Give it HTML_LIST settings (scope `tbody`) if Assam starts posting there again." },
  "mp-dme": { kind: "HTML_JS", config: {}, active: false, notes: "OFF: the home page is a service portal (links to login pages and notices from the 2020-21 session); there is no notice list to read." },
  "mizoram-mc": { kind: "HTML_JS", config: {}, active: false, notes: "OFF: a single-page choice-filling application; the only text is last year's (2025) schedule. There is no notice list to read." },
  "punjab-bfuhs": { kind: "HTML_JS", config: {}, active: false, notes: "OFF: the notice pages (examination.bfuhsonline.ac.in) are form grids without notice links, and the home page's news strip is built by JavaScript. Nothing can be read as links." },
};

/** Notes written by earlier seeds. A source whose notes still start like this was never edited by staff, so its note may be refreshed. */
const OLD_SEED_NOTES = ["Waiting for the HTML adapter", "Cannot be read as a plain page", "The page is built by JavaScript", "The notice pages (e.g. /document/", "The home page has no notice links", "The notices page (/NewandNotification", "The site is under maintenance"];
const isOldSeedNote = (n: string | null) => !n || OLD_SEED_NOTES.some((p) => n.startsWith(p));

export async function seedNewsSources() {
  const states = await prisma.state.findMany({ select: { id: true, code: true } });
  const stateByCode = new Map(states.map((s) => [s.code, s.id]));
  let created = 0;
  let upgraded = 0;
  for (const s of NEWS_SOURCES) {
    const setup = HTML_SETUP[s.slug];
    const data = {
      kind: setup?.kind ?? s.kind,
      listUrl: setup?.listUrl ?? s.listUrl,
      config: (setup?.config ?? {}) as object,
      isActive: setup ? (setup.active ?? Object.keys(setup.config).length > 0) : (s.active ?? false),
      notes: setup?.notes ?? s.notes ?? null,
    };
    const exists = await prisma.newsSource.findUnique({ where: { slug: s.slug }, select: { id: true, config: true, kind: true, notes: true } });
    if (!exists) {
      await prisma.newsSource.create({ data: { slug: s.slug, name: s.name, stateId: s.state ? (stateByCode.get(s.state) ?? null) : null, siteUrl: s.siteUrl, ...data } });
      created++;
    } else if (
      setup &&
      JSON.stringify(exists.config ?? {}) === "{}" &&
      (Object.keys(setup.config).length > 0 || (setup.kind !== undefined && setup.kind !== exists.kind) || (isOldSeedNote(exists.notes) && exists.notes !== data.notes))
    ) {
      // Step N2 settings for a source created by the step N1 seed (still unconfigured, or still of the
      // old kind). A source whose settings staff have already edited is never touched, and a source
      // that is already up to date is left alone, so running the seed twice changes nothing.
      await prisma.newsSource.update({ where: { id: exists.id }, data: { ...data, etag: null, lastModified: null } });
      upgraded++;
    }
  }
  return { created, upgraded, total: NEWS_SOURCES.length };
}
