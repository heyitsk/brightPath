/*
  SAMPLE STATE COUNSELLING DATA.
  The content API does not exist yet (GET /counselling/states/{slug}, backendPlan phase 7). The
  types use the field names of backendPlan 4.2 (State) and 4.5 (StateCounselling,
  CounsellingStep). FAQs use the shared Faq type from 4.7. Dates are ISO "YYYY-MM-DD" strings.

  Every number, date and text below is SAMPLE data from the v3 preview (08-state) and has not
  been checked. Counselling step dates stay null until the official notice is out; the page
  shows "date not announced yet" and never a guessed date.

  Switching to the real API means changing ONE function: getStateCounselling(). The route
  loader calls nothing else. The college table comes from colleges.ts, so the same sample
  colleges show on the college pages, this page and the menus.
*/
import { getSource, listCollegesByState, type ClosingRank, type IndiaCollegeRow, type Source } from './colleges'
import type { Faq } from './countries'

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
  /** Which closing ranks the college table shows. Added for the page. */
  closingRanks: { year: number; round: ClosingRank['round']; source: Source | null }
  colleges: IndiaCollegeRow[]
  /** Colleges taking part in this state's counselling. null = not counted yet, shown as a [placeholder]. */
  totalColleges: number | null
}

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
  // "UP NEET UG allotment lists 2025" in colleges.ts
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

const faq = (sort: number, question: string): Faq => ({
  scope: 'STATE',
  scopeRefId: 1,
  question,
  answer: '[Answer checked against the official notice.]',
  sort,
  isPublished: true,
})

const UP_FAQS: Faq[] = [
  faq(1, 'Can I apply in UP and through All India Quota at the same time?'),
  faq(2, 'What counts as UP domicile?'),
  faq(3, 'What happens if I leave a seat after round 2?'),
]

const SAMPLE_STATES = [
  {
    state: UP_STATE,
    counselling: UP_COUNSELLING,
    steps: UP_STEPS,
    faqs: UP_FAQS,
    closingRanks: { year: 2025, round: 2 as const, sourceId: 6 },
    totalColleges: null,
  },
]

/** Slugs of the sample states, so the menus can link to pages that exist. */
export const SAMPLE_STATE_SLUGS = SAMPLE_STATES.map((s) => s.state.slug)

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
  const { year, round, sourceId } = found.closingRanks
  return {
    state: found.state,
    counselling: found.counselling,
    source: await getSource(found.counselling.sourceId),
    steps: [...found.steps].sort((a, b) => a.sort - b.sort),
    faqs: found.faqs.filter((f) => f.isPublished),
    closingRanks: { year, round, source: await getSource(sourceId) },
    colleges: await listCollegesByState(slug, year, round),
    totalColleges: found.totalColleges,
  }
}
