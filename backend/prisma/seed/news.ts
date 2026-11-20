import type { NewsSourceKind } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/prisma";

// The official sites the owner asked to watch (plan §15, history D-132 to D-143).
// Inserts only what is missing (matched by slug): sources staff have since edited are left alone,
// so re-running the seed is safe. Needs the states from the reference seed.
//
// Only sources whose kind has an adapter are switched on. The rest are listed so staff can see
// them, but stay off until their adapter exists (HTML: step N2, JavaScript pages: step N5).

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
const N5 = "The page is built by JavaScript, so it needs the headless-browser fetcher (step N5).";

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

export async function seedNewsSources() {
  const states = await prisma.state.findMany({ select: { id: true, code: true } });
  const stateByCode = new Map(states.map((s) => [s.code, s.id]));
  let created = 0;
  for (const s of NEWS_SOURCES) {
    const exists = await prisma.newsSource.findUnique({ where: { slug: s.slug }, select: { id: true } });
    if (exists) continue;
    await prisma.newsSource.create({
      data: {
        slug: s.slug,
        name: s.name,
        stateId: s.state ? (stateByCode.get(s.state) ?? null) : null,
        kind: s.kind,
        listUrl: s.listUrl,
        siteUrl: s.siteUrl,
        isActive: s.active ?? false,
        notes: s.notes ?? null,
      },
    });
    created++;
  }
  return { created, total: NEWS_SOURCES.length };
}
