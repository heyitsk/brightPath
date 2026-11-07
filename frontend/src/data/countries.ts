/*
  SAMPLE COUNTRY DATA.
  The content API does not exist yet (GET /countries/{slug}, backendPlan phase 7). The types use
  the field names of backendPlan 4.2 (Country) and 4.7 (country content, Faq). Dates are ISO
  "YYYY-MM-DD" strings, as they will arrive in JSON.

  Every number, date and text below is SAMPLE data from the v3 preview (05-country) and has not
  been checked. Author and reviewer names stay null and render as [placeholders].

  Switching to the real API means changing ONE function: getCountry(). The route loader calls
  nothing else. The college list comes from colleges.ts, so the same sample colleges show on the
  college pages, the country page and the menus.

  4.7 only names the content fields loosely ("intro, why-study, typical fee range, recognition
  explainer, admission steps, lastCheckedAt, sources"). The extra fields the preview needs are
  marked "added for the page" and will have to come from the content API too.
*/
import { listCollegesByCountry, type AbroadCollegeRow, type NmcNotice } from './colleges'

/* ---------- 4.2 ---------- */

export type Country = {
  id: number
  slug: string
  name: string
  isoCode: string
  status: 'LIVE' | 'COMING_SOON'
  nearIndia: boolean
  /** e.g. "6 – 8 hours" */
  typicalFlightFromDelhi: string | null
  sortOrder: number
}

/* ---------- 4.7 ---------- */

export type Faq = {
  scope: 'GLOBAL' | 'RANK_PREDICTOR' | 'COLLEGE_FINDER' | 'COUNTRY' | 'STATE' | 'GUIDE' | 'COLLEGE'
  scopeRefId: number | null
  question: string
  answer: string
  sort: number
  isPublished: boolean
}

export type CostRow = {
  label: string
  /** Rupees, a range. min === max shows a single figure. */
  perYearInr: { min: number; max: number }
  wholeCourseInr: { min: number; max: number }
}

export type CountryContent = {
  countryId: number
  intro: string
  /** "Why students choose it" */
  whyStudy: string[]
  typicalFeeRange: { minInr: number; maxInr: number }
  /** Paragraph above the rule list. */
  recognitionExplainer: string
  /** "Who can apply" lines. 4.7 calls this "admission steps". */
  admissionSteps: string[]
  lastCheckedAt: string | null
  sources: { title: string; url: string; checkedAt: string | null }[]

  // Added for the page (not named in 4.7):
  /** null until the author and reviewer are decided; shown as [placeholders]. */
  writtenBy: string | null
  reviewedBy: string | null
  updatedAt: string | null
  heroImageUrl: string | null
  heroImageHint: string
  courseLengthMonths: number
  teachingLanguage: string
  intakeMonths: string[]
  winterLow: string | null
  /** The four FMGL 2021 rules, in the page's own words: bold part, then the rest. */
  recognitionRules: { strong: string; rest: string }[]
  /** "What to be careful about" */
  cautions: string[]
  costRows: CostRow[]
  costNote: string
  fx: { currency: string; rateToInr: number; asOf: string } | null
}

export type CountryDetail = {
  country: Country
  content: CountryContent
  faqs: Faq[]
  /** Active COUNTRY-scope notices. College notices show on each college row. */
  nmcNotices: NmcNotice[]
  colleges: AbroadCollegeRow[]
}

/* ---------- Sample data ---------- */

const lakh = (n: number) => Math.round(n * 100_000)
const range = (a: number, b: number = a) => ({ min: lakh(a), max: lakh(b) })

const RUSSIA: Omit<CountryDetail, 'colleges'> = {
  country: {
    id: 1,
    slug: 'russia',
    name: 'Russia',
    isoCode: 'RU',
    status: 'LIVE',
    nearIndia: false,
    typicalFlightFromDelhi: '6 – 8 hours',
    sortOrder: 1,
  },
  content: {
    countryId: 1,
    intro:
      "Russia has more Indian medical students than any other country abroad. Here is what it costs, which colleges meet NMC's rules, and what to watch out for.",
    whyStudy: [
      'Large public universities with big teaching hospitals.',
      'Lower fees than private colleges in India.',
      'Many Indian students, Indian food in most cities.',
    ],
    typicalFeeRange: { minInr: lakh(22), maxInr: lakh(55) },
    recognitionExplainer:
      'NMC does not approve foreign colleges. Instead, it sets rules that your course must follow, called the Foreign Medical Graduate Licentiate Regulations, 2021. If your course meets them, you can sit the licensing exam in India when you return.',
    admissionSteps: [
      'You have qualified NEET UG in the last three years.',
      'You scored at least 50% in Physics, Chemistry and Biology in Class 12 (40% for SC, ST and OBC).',
      'You are 17 or older on 31 December of the year you join.',
    ],
    lastCheckedAt: '2026-10-14',
    sources: [],
    writtenBy: null,
    reviewedBy: null,
    updatedAt: '2026-10-14',
    heroImageUrl: null,
    heroImageHint: 'Real photo with credit, e.g. Kazan',
    courseLengthMonths: 72,
    teachingLanguage: 'English, with Russian',
    intakeMonths: ['September'],
    winterLow: '−10 to −30 °C',
    recognitionRules: [
      { strong: 'At least 54 months of study', rest: ', plus a 12-month internship at the same college.' },
      { strong: 'Taught in English', rest: ' for the whole course.' },
      { strong: 'Licence to practise', rest: ' in Russia once you finish, the same as a Russian graduate.' },
      { strong: 'Back in India:', rest: ' a further 12-month internship and the licensing exam (FMGE now, NExT later).' },
    ],
    cautions: [
      'Patients speak Russian. You must learn it for clinical years.',
      'Long, very cold winters.',
      'You still need to pass FMGE or NExT in India.',
    ],
    costRows: [
      { label: 'Tuition', perYearInr: range(3.5, 7), wholeCourseInr: range(21, 42) },
      { label: 'Hostel', perYearInr: range(0.4, 1), wholeCourseInr: range(2.4, 6) },
      { label: 'Food and living', perYearInr: range(1.2, 1.8), wholeCourseInr: range(7, 11) },
      { label: 'Visa, insurance, medical tests', perYearInr: range(0.2), wholeCourseInr: range(1.2) },
      { label: 'Flights home, once a year', perYearInr: range(0.5), wholeCourseInr: range(3) },
    ],
    costNote: 'Sample figures.',
    fx: { currency: 'RUB', rateToInr: 1.05, asOf: '2026-10-01' },
  },
  faqs: [
    {
      scope: 'COUNTRY',
      scopeRefId: 1,
      question: 'Do I need to know Russian before I go?',
      answer: "No. Colleges teach Russian in the first years. You'll need it to talk to patients later.",
      sort: 1,
      isPublished: true,
    },
    {
      scope: 'COUNTRY',
      scopeRefId: 1,
      question: 'Is it safe for Indian students?',
      answer: '[Answer written and checked by the team.]',
      sort: 2,
      isPublished: true,
    },
    {
      scope: 'COUNTRY',
      scopeRefId: 1,
      question: 'Can I pay fees year by year?',
      answer: '[Answer written and checked by the team.]',
      sort: 3,
      isPublished: true,
    },
  ],
  nmcNotices: [],
}

const SAMPLE_COUNTRIES = [RUSSIA]

/** Slugs of the sample countries, so the menus can link to pages that exist. */
export const SAMPLE_COUNTRY_SLUGS = SAMPLE_COUNTRIES.map((c) => c.country.slug)

/**
 * The one place the country page gets its data. SAMPLE today; replace the body with
 * GET /countries/{slug} (and unwrap it) when it exists. Returns null for an unknown slug or a
 * country that is not live, and the route turns that into a 404.
 */
export async function getCountry(slug: string): Promise<CountryDetail | null> {
  const found = SAMPLE_COUNTRIES.find((c) => c.country.slug === slug && c.country.status === 'LIVE')
  if (!found) return null
  return {
    ...found,
    faqs: found.faqs.filter((f) => f.isPublished),
    nmcNotices: found.nmcNotices.filter((n) => n.isActive),
    colleges: await listCollegesByCountry(slug),
  }
}
