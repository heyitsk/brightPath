/*
  SAMPLE STATE COUNSELLING DATA.
  The content API does not exist yet (GET /counselling/states/{slug}, backendPlan phase 7). The
  types use the field names of backendPlan 4.2 (State) and 4.5 (StateCounselling,
  CounsellingStep). FAQs use the shared Faq type from 4.7. Dates are ISO "YYYY-MM-DD" strings.

  Every number, date and text below is SAMPLE data from the v3 preview (08-state) and has not
  been checked. Counselling step dates stay null until the official notice is out; the page
  shows "date not announced yet" and never a guessed date.

  Switching to the real API means changing ONE function: getStateCounselling(). The college
  table is not sample: the route loader adds it from GET /colleges/?kind=INDIA&state=<slug>, so
  the college pages, this page and the menus agree. Closing ranks are not in the API yet
  (phase 5), so the table does not show them.
*/
import type { CollegeCard } from './colleges'
import type { Faq } from './countries'

/* ---------- 4.2 Sources (sample) ---------- */

export type Source = {
  id: number
  kind: 'NTA' | 'MCC' | 'STATE_COUNSELLING' | 'NMC' | 'WDOMS' | 'COLLEGE_WEBSITE' | 'OTHER'
  title: string
  publisher: string
  url: string
  notes: string | null
}

const SOURCES: Source[] = [
  {
    id: 6,
    kind: 'STATE_COUNSELLING',
    title: 'UP NEET UG allotment lists 2025',
    publisher: 'Directorate General of Medical Education, UP',
    url: 'https://upneet.gov.in/',
    notes: null,
  },
]

const getSource = (id: number): Source | null => SOURCES.find((s) => s.id === id) ?? null

/* ---------- 4.2 ---------- */

export type State = {
  id: number
  slug: string
  name: string
  code: string
  isLive: boolean
  sortOrder: number
}

/* ---------- 4.5 ---------- */

export type StateCounselling = {
  id: number
  stateId: number
  runnerName: string
  runnerUrl: string
  seatsRule: string
  whoCanApply: string
  status: 'DRAFT' | 'PUBLISHED'
  updatedAt: string | null
  sourceId: number
  checkedAt: string | null
  isPublished: boolean
}

export type CounsellingStep = {
  stateCounsellingId: number
  sort: number
  title: string
  description: string
  /** null until the official notice gives a date. Never guessed. */
  date: string | null
}

export type StateCounsellingDetail = {
  state: State
  counselling: StateCounselling
  /** The notice the page was checked against. */
  source: Source | null
  steps: CounsellingStep[]
  faqs: Faq[]
  /** Colleges taking part in this state's counselling. null = not counted yet; the page shows only the listed count. */
  totalColleges: number | null
}

/** What the state route renders: the sample content plus the listed colleges from the API. */
export type StatePageData = StateCounsellingDetail & { colleges: CollegeCard[] }

/* ---------- Sample data ---------- */

const UP_STATE: State = { id: 1, slug: 'uttar-pradesh', name: 'Uttar Pradesh', code: 'UP', isLive: true, sortOrder: 1 }

const UP_COUNSELLING: StateCounselling = {
  id: 1,
  stateId: 1,
  runnerName: 'Directorate General of Medical Education and Training (DGME), Uttar Pradesh.',
  runnerUrl: 'https://upneet.gov.in/',
  seatsRule: '85% of seats in UP government colleges, and all seats in private colleges, except the All India Quota.',
  whoCanApply: 'Government seats need UP domicile. Private college seats are open to students from any state.',
  status: 'PUBLISHED',
  updatedAt: '2026-09-22',
  // "UP NEET UG allotment lists 2025" above
  sourceId: 6,
  checkedAt: '2026-09-22',
  isPublished: true,
}

const step = (sort: number, title: string, description: string): CounsellingStep => ({
  stateCounsellingId: 1,
  sort,
  title,
  description,
  date: null,
})

const UP_STEPS: CounsellingStep[] = [
  step(1, 'Register and pay the fee', 'On the DGME UP counselling website, with your NEET roll number.'),
  step(2, 'Upload documents and get verified', 'Domicile certificate, Class 10 and 12 marksheets, category certificate.'),
  step(3, 'Fill and lock your choices', 'List colleges in your order of preference. Order matters more than the number of choices.'),
  step(4, 'Seat allotment, round 1', 'Report to the college with original documents, or wait for round 2.'),
]

/* No UP questions yet: they are added once each answer is checked against the official notice. */
const UP_FAQS: Faq[] = []

const SAMPLE_STATES = [
  {
    state: UP_STATE,
    counselling: UP_COUNSELLING,
    steps: UP_STEPS,
    faqs: UP_FAQS,
    totalColleges: null,
  },
]

/** Slugs of the sample states, so the menus can link to pages that exist. */
export const SAMPLE_STATE_SLUGS = SAMPLE_STATES.map((s) => s.state.slug)

/** The states that have a counselling page, for the menus. Menus list only these. */
export const SAMPLE_STATE_PAGES = SAMPLE_STATES.map(({ state }) => ({ slug: state.slug, name: state.name }))

/**
 * The one place the state page gets its data. SAMPLE today; replace the body with
 * GET /counselling/states/{slug} (and unwrap it) when it exists. Returns null for an unknown
 * slug or an unpublished page, and the route turns that into a 404.
 */
export async function getStateCounselling(slug: string): Promise<StateCounsellingDetail | null> {
  const found = SAMPLE_STATES.find(
    (s) => s.state.slug === slug && s.state.isLive && s.counselling.isPublished && s.counselling.status === 'PUBLISHED',
  )
  if (!found) return null
  return {
    state: found.state,
    counselling: found.counselling,
    source: getSource(found.counselling.sourceId),
    steps: [...found.steps].sort((a, b) => a.sort - b.sort),
    faqs: found.faqs.filter((f) => f.isPublished),
    totalColleges: found.totalColleges,
  }
}
