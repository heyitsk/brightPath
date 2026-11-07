/*
  SAMPLE COLLEGE DATA.
  The colleges API does not exist yet (backendPlan phase 4). The types below use the field
  names of backendPlan section 4.4 (College, CollegeIndiaProfile, CollegeAbroadProfile,
  CollegeFeeLine, CollegeSourceLink, CollegeFaq) and 4.2 (Source, NmcNotice). Dates are
  ISO "YYYY-MM-DD" strings, as they will arrive in JSON.

  Every number, date and status below is SAMPLE data and has not been checked.
  Only "Kazan Federal University" uses a real college name (to match the v3 preview);
  everything that shows an alert or an UNKNOWN status is on made-up colleges.

  Switching to the real API means changing ONE function: getCollege(). The route loader calls
  nothing else. The types may then be replaced with the generated ones from schema.d.ts.

  Two deliberate additions to 4.4, because the pages need them:
    - ClosingRank (backendPlan 4.5) and CounsellingBody: the India page shows past closing ranks.
    - CollegeDetail adds resolved display names (country, state), the derived fields the plan
      lists ("totalCourseFeeInr", "nmcAlertStatus"), and a "related" list. The API will have
      to return these resolved too, the page cannot look them up.
*/

/* ---------- 4.2 Reference and provenance ---------- */

export type Source = {
  id: number
  kind: 'NTA' | 'MCC' | 'STATE_COUNSELLING' | 'NMC' | 'WDOMS' | 'COLLEGE_WEBSITE' | 'OTHER'
  title: string
  publisher: string
  url: string
  notes: string | null
}

export type NmcNotice = {
  title: string
  url: string
  publishedAt: string
  severity: 'ADVISORY' | 'WARNING'
  scope: 'COLLEGE' | 'COUNTRY'
  collegeId: number | null
  countryId: number | null
  isActive: boolean
  checkedAt: string
}

/* ---------- 4.4 Colleges ---------- */

export type Ownership = 'GOVERNMENT' | 'PRIVATE' | 'DEEMED' | 'TRUST'

export type College = {
  id: number
  slug: string
  kind: 'INDIA' | 'ABROAD'
  name: string
  shortName: string | null
  city: string
  stateId: number | null
  countryId: number
  ownership: Ownership
  establishedYear: number | null
  /** Own words, plain text paragraphs separated by a blank line. */
  description: string
  heroImageUrl: string | null
  galleryJSON: { url: string | null; caption: string }[]
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED'
  publishedAt: string | null
  /** Derived at publish time. */
  lastCheckedAt: string | null
  verification: 'UNVERIFIED' | 'VERIFIED'
  importBatchId: number | null
}

export type CollegeIndiaProfile = {
  collegeId: number
  /** null = not confirmed yet. */
  nmcRecognised: boolean | null
  nmcRecognitionCheckedAt: string | null
  mbbsSeats: number
  hospitalName: string | null
  hospitalBeds: number | null
  dailyOutpatients: number | null
  serviceBondYears: number | null
  serviceBondPenaltyInr: number | null
  stipendInr: number | null
  domicileRule: string
  counsellingBodyId: number
}

export type Nmc2021Status = 'MEETS' | 'DOES_NOT_MEET' | 'UNKNOWN'

export type CollegeAbroadProfile = {
  collegeId: number
  wdomsListed: 'LISTED' | 'NOT_LISTED' | 'UNKNOWN'
  wdomsId: string | null
  wdomsUrl: string | null
  courseLengthMonths: number
  internshipMonths: number | null
  teachingLanguage: string
  /** e.g. "Russian from year 3" */
  languageNote: string | null
  intakeMonths: string[]
  seatsForIndians: number | null
  /** backendPlan lists "QUALIFIED|…": only QUALIFIED is known so far. */
  minNeet: 'QUALIFIED'
  eligibility: {
    ageRule: string | null
    class12Pcb: { category: string; percent: number }[]
  }
  documents: string[]
  flightFromDelhi: string | null
  /** Derived from the three booleans below. Use deriveNmc2021(), never set it by hand. */
  nmc2021Status: Nmc2021Status
  /** null = not checked yet. */
  nmcLengthOk: boolean | null
  nmcEnglishOk: boolean | null
  nmcInternshipOk: boolean | null
}

export type CollegeFeeLine = {
  collegeId: number
  scope: 'PER_YEAR' | 'ONE_TIME'
  yearNumber: number | null
  academicYear: string
  /** Amounts are in `currency`. */
  tuition: number
  hostel: number
  other: number
  currency: string
  fxRateToInr: number
  fxRateDate: string | null
  totalInr: number
  sourceId: number
  checkedAt: string
}

export type CollegeSourceLink = {
  collegeId: number
  sourceId: number
  purpose:
    | 'WDOMS'
    | 'FEE_NOTICE'
    | 'NMC_NOTICES'
    | 'NMC_RECOGNITION'
    | 'SEAT_LIST'
    | 'COUNSELLING'
    | 'COLLEGE_WEBSITE'
  url: string
  checkedAt: string
  checkedBy: string
}

export type CollegeFaq = {
  collegeId: number
  question: string
  answer: string
  sort: number
}

/* ---------- 4.5 (added for the India page) ---------- */

export type CounsellingBody = {
  id: number
  code: 'MCC' | 'STATE'
  name: string
  stateId: number | null
  website: string
}

export type ClosingRank = {
  collegeId: number
  year: number
  counsellingBodyId: number
  quota: 'ALL_INDIA' | 'STATE' | 'MANAGEMENT' | 'NRI' | 'DEEMED'
  category: 'GENERAL' | 'EWS' | 'OBC' | 'SC' | 'ST'
  isPwd: boolean
  round: 1 | 2 | 3 | 'STRAY'
  /** All-India rank of the last admit. Lower is harder. */
  closingRank: number
  seats: number | null
  sourceId: number
  checkedAt: string
}

/* ---------- What getCollege() returns ---------- */

export type RelatedCollege = { slug: string; name: string; city: string; totalCourseFeeInr: number | null }

type CollegeDetailBase = {
  countryName: string
  countrySlug: string
  /** Three-letter code, e.g. RUS. Used in the machine-readable line on abroad pages. */
  countryCode: string
  stateName: string | null
  stateSlug: string | null
  feeLines: CollegeFeeLine[]
  sources: Source[]
  sourceLinks: CollegeSourceLink[]
  faqs: CollegeFaq[]
  /** Active notices for this college or its country. */
  nmcNotices: NmcNotice[]
  /** Derived at publish time. null when there are no fee lines. */
  totalCourseFeeInr: number | null
  /** Derived at publish time from active NmcNotice rows. */
  nmcAlertStatus: 'ALERT' | 'NONE'
  related: RelatedCollege[]
}

export type AbroadCollegeDetail = CollegeDetailBase & {
  college: College & { kind: 'ABROAD' }
  abroadProfile: CollegeAbroadProfile
}

export type IndiaCollegeDetail = CollegeDetailBase & {
  college: College & { kind: 'INDIA' }
  indiaProfile: CollegeIndiaProfile
  counsellingBody: CounsellingBody
  closingRanks: ClosingRank[]
}

export type CollegeDetail = AbroadCollegeDetail | IndiaCollegeDetail

export const isAbroad = (d: CollegeDetail): d is AbroadCollegeDetail => d.college.kind === 'ABROAD'
export const isIndia = (d: CollegeDetail): d is IndiaCollegeDetail => d.college.kind === 'INDIA'

/** NMC 2021 check from the three booleans: all true = meets, any false = does not meet, else unknown. */
export function deriveNmc2021(
  lengthOk: boolean | null,
  englishOk: boolean | null,
  internshipOk: boolean | null,
): Nmc2021Status {
  const checks = [lengthOk, englishOk, internshipOk]
  if (checks.some((c) => c === false)) return 'DOES_NOT_MEET'
  if (checks.every((c) => c === true)) return 'MEETS'
  return 'UNKNOWN'
}

/* ---------- Sample data ---------- */

const CHECKED = '2026-10-12'
const CHECKED_INDIA = '2026-09-22'
const FX_DATE = '2026-10-01'

const SOURCES: Source[] = [
  { id: 1, kind: 'WDOMS', title: 'World Directory of Medical Schools', publisher: 'WFME and FAIMER', url: 'https://www.wdoms.org/', notes: null },
  { id: 2, kind: 'COLLEGE_WEBSITE', title: 'College fee notice, 2026 intake', publisher: 'Kazan Federal University', url: 'https://kpfu.ru/', notes: null },
  { id: 3, kind: 'NMC', title: 'NMC public notices page', publisher: 'National Medical Commission', url: 'https://www.nmc.org.in/', notes: null },
  { id: 4, kind: 'COLLEGE_WEBSITE', title: 'College fee notice, 2026 intake', publisher: 'Sample Medical University', url: 'https://example.org/sample-medical-university/fees', notes: null },
  { id: 5, kind: 'NMC', title: 'NMC seat list 2026', publisher: 'National Medical Commission', url: 'https://www.nmc.org.in/', notes: null },
  { id: 6, kind: 'STATE_COUNSELLING', title: 'UP NEET UG allotment lists 2025', publisher: 'Directorate General of Medical Education, UP', url: 'https://upneet.gov.in/', notes: null },
  { id: 7, kind: 'COLLEGE_WEBSITE', title: 'College prospectus 2026', publisher: 'Sample Government Medical College', url: 'https://example.org/sample-government-medical-college/prospectus', notes: null },
  { id: 9, kind: 'NMC', title: 'NMC list of recognised medical colleges', publisher: 'National Medical Commission', url: 'https://www.nmc.org.in/', notes: null },
  { id: 8, kind: 'COLLEGE_WEBSITE', title: 'College prospectus 2026', publisher: 'Sample Private Medical College', url: 'https://example.org/sample-private-medical-college/prospectus', notes: null },
]

const UP_COUNSELLING: CounsellingBody = {
  id: 1,
  code: 'STATE',
  name: 'Uttar Pradesh NEET UG counselling',
  stateId: 1,
  website: 'https://upneet.gov.in/',
}

const link = (
  collegeId: number,
  sourceId: number,
  purpose: CollegeSourceLink['purpose'],
  checkedAt: string,
  url?: string,
): CollegeSourceLink => ({
  collegeId,
  sourceId,
  purpose,
  url: url ?? SOURCES.find((s) => s.id === sourceId)!.url,
  checkedAt,
  checkedBy: 'Sample reviewer',
})

/** Builds a PER_YEAR abroad fee line; totalInr is the sum of the converted parts. */
function abroadFee(
  collegeId: number,
  yearNumber: number,
  [tuition, hostel, other]: [number, number, number],
  rate: number,
  currency: string,
  sourceId: number,
): CollegeFeeLine {
  return {
    collegeId,
    scope: 'PER_YEAR',
    yearNumber,
    academicYear: `Year ${yearNumber}`,
    tuition,
    hostel,
    other,
    currency,
    fxRateToInr: rate,
    fxRateDate: FX_DATE,
    totalInr: Math.round(tuition * rate) + Math.round(hostel * rate) + Math.round(other * rate),
    sourceId,
    checkedAt: CHECKED,
  }
}

function indiaFee(collegeId: number, yearNumber: number, [tuition, hostel, other]: [number, number, number], sourceId: number): CollegeFeeLine {
  return {
    collegeId,
    scope: 'PER_YEAR',
    yearNumber,
    academicYear: `Year ${yearNumber}`,
    tuition,
    hostel,
    other,
    currency: 'INR',
    fxRateToInr: 1,
    fxRateDate: null,
    totalInr: tuition + hostel + other,
    sourceId,
    checkedAt: CHECKED_INDIA,
  }
}

const baseCollege = {
  shortName: null,
  heroImageUrl: null,
  status: 'PUBLISHED',
  publishedAt: '2026-10-12',
  verification: 'UNVERIFIED',
  importBatchId: null,
} as const

const GALLERY = [
  { url: null, caption: 'Main campus photo' },
  { url: null, caption: 'Teaching hospital' },
  { url: null, caption: 'Hostel room' },
]

const kfuNmc = { length: true, english: true, internship: true }
const smuNmc = { length: null, english: true, internship: true }

const KAZAN_FEES: [number, number, number][] = [
  [400_000, 60_000, 40_000],
  [400_000, 60_000, 20_000],
  [410_000, 60_000, 20_000],
  [410_000, 60_000, 20_000],
  [420_000, 60_000, 20_000],
  [420_000, 60_000, 20_000],
]

const KFU: AbroadCollegeDetail = {
  college: {
    ...baseCollege,
    id: 1,
    slug: 'kazan-federal-university',
    kind: 'ABROAD',
    name: 'Kazan Federal University, Institute of Fundamental Medicine and Biology',
    city: 'Kazan, Republic of Tatarstan',
    stateId: null,
    countryId: 1,
    ownership: 'GOVERNMENT',
    establishedYear: null,
    description:
      '[Sample text. Two or three short paragraphs in our own words: when the medical faculty started, how many international students study here, which hospitals students train in, and what life in Kazan is like.]',
    galleryJSON: GALLERY,
    lastCheckedAt: CHECKED,
  },
  abroadProfile: {
    collegeId: 1,
    wdomsListed: 'LISTED',
    wdomsId: 'F0003266',
    wdomsUrl: 'https://www.wdoms.org/',
    courseLengthMonths: 72,
    internshipMonths: 12,
    teachingLanguage: 'English',
    languageNote: 'Russian from year 3',
    intakeMonths: ['September'],
    seatsForIndians: null,
    minNeet: 'QUALIFIED',
    eligibility: {
      ageRule: '17 by 31 December of the joining year',
      class12Pcb: [
        { category: 'General', percent: 50 },
        { category: 'SC, ST, OBC', percent: 40 },
      ],
    },
    documents: ['Passport', 'NEET scorecard', 'Class 10 and 12 marksheets'],
    flightFromDelhi: null,
    nmc2021Status: deriveNmc2021(kfuNmc.length, kfuNmc.english, kfuNmc.internship),
    nmcLengthOk: kfuNmc.length,
    nmcEnglishOk: kfuNmc.english,
    nmcInternshipOk: kfuNmc.internship,
  },
  countryName: 'Russia',
  countrySlug: 'russia',
  countryCode: 'RUS',
  stateName: null,
  stateSlug: null,
  feeLines: KAZAN_FEES.map((f, i) => abroadFee(1, i + 1, f, 1.05, 'RUB', 2)),
  sources: SOURCES,
  sourceLinks: [
    link(1, 1, 'WDOMS', CHECKED),
    link(1, 2, 'FEE_NOTICE', CHECKED),
    link(1, 3, 'NMC_NOTICES', CHECKED),
  ],
  faqs: [
    { collegeId: 1, question: 'Is there a hostel for first-year students?', answer: '[Sample answer, to be checked with the college.]', sort: 1 },
    { collegeId: 1, question: 'When do I learn Russian?', answer: '[Sample answer, to be checked with the college.]', sort: 2 },
  ],
  nmcNotices: [],
  totalCourseFeeInr: null,
  nmcAlertStatus: 'NONE',
  related: [],
}

const SMU: AbroadCollegeDetail = {
  college: {
    ...baseCollege,
    id: 2,
    slug: 'sample-medical-university',
    kind: 'ABROAD',
    name: 'Sample Medical University',
    city: 'Sampletown',
    stateId: null,
    countryId: 1,
    ownership: 'PRIVATE',
    establishedYear: null,
    description:
      '[Sample text. This is a made-up college, used to show how the page looks when a fact is unknown and when NMC has issued an alert.]',
    galleryJSON: GALLERY,
    lastCheckedAt: CHECKED,
  },
  abroadProfile: {
    collegeId: 2,
    wdomsListed: 'UNKNOWN',
    wdomsId: null,
    wdomsUrl: null,
    courseLengthMonths: 72,
    internshipMonths: 12,
    teachingLanguage: 'English',
    languageNote: null,
    intakeMonths: ['September'],
    seatsForIndians: null,
    minNeet: 'QUALIFIED',
    eligibility: { ageRule: null, class12Pcb: [] },
    documents: [],
    flightFromDelhi: null,
    nmc2021Status: deriveNmc2021(smuNmc.length, smuNmc.english, smuNmc.internship),
    nmcLengthOk: smuNmc.length,
    nmcEnglishOk: smuNmc.english,
    nmcInternshipOk: smuNmc.internship,
  },
  countryName: 'Russia',
  countrySlug: 'russia',
  countryCode: 'RUS',
  stateName: null,
  stateSlug: null,
  feeLines: [450_000, 450_000, 460_000, 460_000, 470_000, 470_000].map((t, i) =>
    abroadFee(2, i + 1, [t, 70_000, i === 0 ? 50_000 : 25_000], 1.05, 'RUB', 4),
  ),
  sources: SOURCES,
  sourceLinks: [link(2, 4, 'FEE_NOTICE', CHECKED), link(2, 3, 'NMC_NOTICES', CHECKED)],
  faqs: [{ collegeId: 2, question: 'Is the course length confirmed?', answer: '[Sample answer, to be checked with the college.]', sort: 1 }],
  nmcNotices: [
    {
      title: 'Sample NMC notice about Sample Medical University',
      url: 'https://example.org/sample-nmc-notice',
      publishedAt: '2026-04-01',
      severity: 'WARNING',
      scope: 'COLLEGE',
      collegeId: 2,
      countryId: null,
      isActive: true,
      checkedAt: CHECKED,
    },
  ],
  totalCourseFeeInr: null,
  nmcAlertStatus: 'ALERT',
  related: [],
}

const closing = (
  collegeId: number,
  category: ClosingRank['category'],
  round: ClosingRank['round'],
  closingRank: number,
): ClosingRank => ({
  collegeId,
  year: 2025,
  counsellingBodyId: 1,
  quota: 'STATE',
  category,
  isPwd: false,
  round,
  closingRank,
  seats: null,
  sourceId: 6,
  checkedAt: CHECKED_INDIA,
})

const GOV_RANKS: ClosingRank[] = [
  ...(
    [
      ['GENERAL', [6120, 7480, 8010, 8350]],
      ['EWS', [7900, 9200, 9640, null]],
      ['OBC', [11800, 13950, 14600, 15020]],
      ['SC', [58400, 67100, 71300, null]],
      ['ST', [192000, 240500, null, null]],
    ] as const
  ).flatMap(([category, ranks]) =>
    ([1, 2, 3, 'STRAY'] as const).flatMap((round, i) => {
      const rank = ranks[i]
      return rank == null ? [] : [closing(3, category, round, rank)]
    }),
  ),
]

const GOV: IndiaCollegeDetail = {
  college: {
    ...baseCollege,
    id: 3,
    slug: 'sample-government-medical-college',
    kind: 'INDIA',
    name: 'Sample Government Medical College',
    city: 'Lucknow',
    stateId: 1,
    countryId: 2,
    ownership: 'GOVERNMENT',
    establishedYear: null,
    description: '[Sample text. This is a made-up college used to show the layout of an Indian government college page.]',
    galleryJSON: [],
    lastCheckedAt: CHECKED_INDIA,
  },
  indiaProfile: {
    collegeId: 3,
    nmcRecognised: true,
    nmcRecognitionCheckedAt: CHECKED_INDIA,
    mbbsSeats: 100,
    hospitalName: null,
    hospitalBeds: null,
    dailyOutpatients: null,
    serviceBondYears: 2,
    serviceBondPenaltyInr: null,
    stipendInr: null,
    domicileRule:
      '85% of seats go through Uttar Pradesh state counselling, for students with UP domicile. 15% go through All India Quota counselling run by MCC.',
    counsellingBodyId: 1,
  },
  counsellingBody: UP_COUNSELLING,
  closingRanks: GOV_RANKS,
  countryName: 'India',
  countrySlug: 'india',
  countryCode: 'IND',
  stateName: 'Uttar Pradesh',
  stateSlug: 'uttar-pradesh',
  feeLines: [1, 2, 3, 4, 5].map((y) => indiaFee(3, y, [36_000, 12_000, 5_000], 7)),
  sources: SOURCES,
  sourceLinks: [link(3, 5, 'SEAT_LIST', CHECKED_INDIA), link(3, 9, 'NMC_RECOGNITION', CHECKED_INDIA), link(3, 6, 'COUNSELLING', CHECKED_INDIA), link(3, 7, 'FEE_NOTICE', CHECKED_INDIA)],
  faqs: [],
  nmcNotices: [],
  totalCourseFeeInr: null,
  nmcAlertStatus: 'NONE',
  related: [],
}

const PRIVATE: IndiaCollegeDetail = {
  college: {
    ...baseCollege,
    id: 4,
    slug: 'sample-private-medical-college',
    kind: 'INDIA',
    name: 'Sample Private Medical College',
    city: 'Lucknow',
    stateId: 1,
    countryId: 2,
    ownership: 'PRIVATE',
    establishedYear: null,
    description: '[Sample text. This is a made-up college used to show an Indian college whose recognition is not confirmed yet.]',
    galleryJSON: [],
    lastCheckedAt: CHECKED_INDIA,
  },
  indiaProfile: {
    collegeId: 4,
    nmcRecognised: null,
    nmcRecognitionCheckedAt: null,
    mbbsSeats: 150,
    hospitalName: 'Sample teaching hospital',
    hospitalBeds: 750,
    dailyOutpatients: null,
    serviceBondYears: null,
    serviceBondPenaltyInr: null,
    stipendInr: null,
    domicileRule:
      'Seats are filled through Uttar Pradesh state counselling and the management quota. The rules for each quota are on the state counselling page.',
    counsellingBodyId: 1,
  },
  counsellingBody: UP_COUNSELLING,
  closingRanks: [],
  countryName: 'India',
  countrySlug: 'india',
  countryCode: 'IND',
  stateName: 'Uttar Pradesh',
  stateSlug: 'uttar-pradesh',
  feeLines: [1, 2, 3, 4, 5].map((y) => indiaFee(4, y, [1_200_000, 150_000, 60_000], 8)),
  sources: SOURCES,
  sourceLinks: [link(4, 5, 'SEAT_LIST', CHECKED_INDIA), link(4, 8, 'FEE_NOTICE', CHECKED_INDIA)],
  faqs: [],
  nmcNotices: [],
  totalCourseFeeInr: null,
  nmcAlertStatus: 'NONE',
  related: [],
}

/** Fills the derived fields, as the API will do at publish time. */
const withDerived = (d: CollegeDetail): CollegeDetail => ({
  ...d,
  totalCourseFeeInr: d.feeLines.length ? d.feeLines.reduce((sum, l) => sum + l.totalInr, 0) : null,
  nmcAlertStatus: d.nmcNotices.some((n) => n.isActive) ? 'ALERT' : 'NONE',
})

const SAMPLE_COLLEGES: CollegeDetail[] = [KFU, SMU, GOV, PRIVATE].map(withDerived)

/** Slugs of the sample colleges, so the menus can link to pages that exist. */
export const SAMPLE_COLLEGE_SLUGS = SAMPLE_COLLEGES.map((d) => d.college.slug)

/**
 * The one place the college page gets its data. SAMPLE today; replace the body with the
 * colleges API call (and unwrap it) when it exists. Returns null for an unknown or
 * unpublished slug, and the route turns that into a 404.
 */
export async function getCollege(slug: string): Promise<CollegeDetail | null> {
  const found = SAMPLE_COLLEGES.find((d) => d.college.slug === slug && d.college.status === 'PUBLISHED')
  if (!found) return null

  const others = SAMPLE_COLLEGES.filter((d) => d.college.kind === found.college.kind && d.college.id !== found.college.id)
  const sameCity = others.filter((d) => d.college.city === found.college.city)
  const related = (sameCity.length ? sameCity : others.filter((d) => d.college.countryId === found.college.countryId)).map(
    (d) => ({ slug: d.college.slug, name: d.college.name, city: d.college.city, totalCourseFeeInr: d.totalCourseFeeInr }),
  )
  return { ...found, related }
}
