/*
  SAMPLE HOME PAGE DATA.
  The college record, check dates and destination lists below are sample data from the
  v3 preview (01-home). College names come from the research list; numbers, dates and
  statuses are not checked. Replace with API data when the college, country and state
  endpoints exist. Links use the same `published` rule as the menus (see navigation.ts).
*/
import type { NavItem } from './navigation'

const unpublished = (label: string, href: string): NavItem => ({ label, href, published: false })

export type SampleCollege = {
  name: string
  place: string
  marks: { tone: 'green' | 'violet' | 'grey'; icon?: 'check' | 'shield'; label: string }[]
  checkedOn: string
}

export const SAMPLE_COLLEGE: SampleCollege = {
  name: 'Kazan Federal University, Institute of Fundamental Medicine and Biology',
  place: 'Kazan, Russia · 6 years · taught in English',
  marks: [
    { tone: 'green', icon: 'check', label: 'Listed in WDOMS' },
    { tone: 'violet', icon: 'shield', label: 'Meets NMC 2021 rules' },
    { tone: 'grey', label: 'No NMC alert found' },
  ],
  checkedOn: '12 Oct 2026',
}

/** Dates printed on the "Every fact carries its stamp" examples. SAMPLE. */
export const SAMPLE_STAMP_DATES = {
  wdoms: 'checked 12 Oct 2026',
  nmcRules: 'checked 12 Oct 2026',
  alert: 'see notice of 1 Apr 2026',
}

export type Destination = { code: string; name: string; meta: string; item: NavItem }

export const SAMPLE_ABROAD: Destination[] = [
  { code: 'RUS', name: 'Russia', meta: '6 years · from ₹ [xx] lakh total', item: unpublished('Russia', '/mbbs-in-russia') },
  { code: 'KAZ', name: 'Kazakhstan', meta: '5 years + internship · from ₹ [xx] lakh total', item: unpublished('Kazakhstan', '/mbbs-in-kazakhstan') },
  { code: 'KGZ', name: 'Kyrgyzstan', meta: 'Check course length carefully · from ₹ [xx] lakh', item: unpublished('Kyrgyzstan', '/mbbs-in-kyrgyzstan') },
  { code: 'UZB', name: 'Uzbekistan', meta: 'NMC alert on some colleges · from ₹ [xx] lakh', item: unpublished('Uzbekistan', '/mbbs-in-uzbekistan') },
  { code: 'GEO', name: 'Georgia', meta: '6 years · from ₹ [xx] lakh total', item: unpublished('Georgia', '/mbbs-in-georgia') },
  { code: '+3', name: 'Philippines, Nepal, Bangladesh', meta: 'Coming next', item: unpublished('Coming next', '/mbbs-abroad') },
]

export const SAMPLE_INDIA: Destination[] = [
  { code: 'UP', name: 'Uttar Pradesh', meta: 'State quota, AIQ and private colleges', item: unpublished('Uttar Pradesh', '/neet-counselling/uttar-pradesh') },
  { code: 'MH', name: 'Maharashtra', meta: 'State quota, AIQ and private colleges', item: unpublished('Maharashtra', '/neet-counselling/maharashtra') },
  { code: 'RJ', name: 'Rajasthan', meta: 'State quota, AIQ and private colleges', item: unpublished('Rajasthan', '/neet-counselling/rajasthan') },
  { code: 'BR', name: 'Bihar', meta: 'State quota, AIQ and private colleges', item: unpublished('Bihar', '/neet-counselling/bihar') },
  { code: '+4', name: 'Madhya Pradesh, Karnataka, Tamil Nadu, Kerala', meta: 'Coming next', item: unpublished('Coming next', '/neet-counselling') },
]

export type GuideLink = { title: string; summary: string; item: NavItem }

export const SAMPLE_GUIDES: GuideLink[] = [
  { title: 'NMC rules for MBBS abroad, explained', summary: 'What the 2021 rules require, and how to check a college', item: unpublished('NMC rules', '/neet/nmc-rules-mbbs-abroad') },
  { title: 'AIQ or state quota: where to apply', summary: 'How the 15% and 85% seats work in counselling', item: unpublished('AIQ or state quota', '/neet/aiq-or-state-quota') },
  { title: 'NEET cut-off and qualifying marks', summary: 'What "qualified" means and what it does not', item: unpublished('NEET cut-off', '/neet/neet-cut-off') },
  { title: 'Documents you need for MBBS abroad', summary: 'Passport, NEET scorecard, eligibility papers and visa', item: unpublished('Documents', '/neet/documents-mbbs-abroad') },
  { title: 'FMGE and NExT after you return', summary: 'The licensing exam every foreign graduate has to pass', item: unpublished('FMGE and NExT', '/neet/fmge-and-next') },
  { title: 'Total cost of MBBS abroad', summary: 'Tuition, hostel, food, flights and the costs people forget', item: unpublished('Total cost', '/neet/total-cost-mbbs-abroad') },
]
