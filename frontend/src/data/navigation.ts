/*
  SAMPLE NAVIGATION DATA.
  The backend has no navigation endpoint yet (GET /navigation/explore is planned for
  phase 7). Until then getNavigation() returns the labels from the v3 menu previews.
  Swap the body of getNavigation() for the API call when it exists; components only
  depend on the Navigation type below.

  Every item carries its real future URL and a `published` flag. Unpublished items are
  rendered without an href (see components/site/MenuLink.tsx), so the menus never link
  to a page that does not exist yet.
*/

export type NavItem = {
  label: string
  href: string
  published: boolean
}

export type ExploreCountry = NavItem & {
  /** Number of published colleges in the country. */
  total: number
  /** Short alert text, shown as a red mark (e.g. NMC alert on some colleges). */
  alert?: { menu: string; mobile: string }
  /** Colleges shown in the desktop mega menu. */
  colleges: NavItem[]
  /** Colleges shown in the phone sheet (shorter list). */
  mobileColleges: NavItem[]
}

export type ExploreState = NavItem & {
  /** College count as display text; null shows a placeholder slot. */
  count: string | null
}

export type DropMenu = {
  id: string
  label: string
  title: string
  intro: string
  primary: NavItem
  columns: { title: string; items: NavItem[] }[]
  /** Shorter list shown in the phone sheet, followed by "See all". */
  mobileItems: NavItem[]
  seeAll: NavItem
}

export type Navigation = {
  explore: {
    abroadNote: string
    countries: ExploreCountry[]
    nextCountries: string[]
    indiaNote: string
    states: ExploreState[]
    findColleges: NavItem
  }
  dropdowns: DropMenu[]
  tools: { icon: 'chart' | 'college' | 'scale' | 'book'; item: NavItem }[]
  about: NavItem
  contact: NavItem
  counsellingCall: NavItem
  whatsappExpert: NavItem
  footer: { title: string; items: NavItem[] }[]
  tabs: { icon: 'chart' | 'college' | 'book' | 'chat'; label: string; item: NavItem; talk?: boolean }[]
}

/* Pages that exist in the app today. Everything else stays unpublished. */
const LIVE = new Set<string>(['/'])

function slugify(label: string) {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function item(label: string, href: string): NavItem {
  return { label, href, published: LIVE.has(href) }
}
const college = (label: string, slug = slugify(label)) => item(label, `/colleges/${slug}`)
const country = (name: string) => item(`MBBS in ${name}`, `/mbbs-in-${slugify(name.replace(/^the /, ''))}`)
const state = (name: string) => item(name, `/neet-counselling/${slugify(name)}`)
const guide = (label: string, slug = slugify(label)) => item(label, `/neet/${slug}`)

const rankPredictor = item('Rank Predictor', '/neet-rank-predictor')
const collegeFinder = item('College Finder', '/college-finder')
const compare = item('Compare colleges', '/compare')
const guides = item('NEET guides', '/neet')
const about = item('About', '/about')
const contact = item('Contact', '/contact')

function exploreCountry(
  name: string,
  total: number,
  colleges: NavItem[],
  mobileCount: number,
  alert?: ExploreCountry['alert'],
): ExploreCountry {
  return {
    ...country(name),
    total,
    alert,
    colleges,
    mobileColleges: colleges.slice(0, mobileCount),
  }
}

const SAMPLE_NAVIGATION: Navigation = {
  explore: {
    abroadNote: 'Every college is listed in WDOMS. Alerts shown in red.',
    countries: [
      exploreCountry(
        'Russia',
        11,
        [
          college('Sechenov University, Moscow', 'sechenov-university'),
          college('Pirogov Russian National Research Medical University'),
          college('Kazan Federal University'),
          college('Kazan State Medical University'),
          college('Bashkir State Medical University'),
          college('Pavlov First St Petersburg State Medical University'),
        ],
        4,
      ),
      exploreCountry(
        'Georgia',
        9,
        [
          college('Tbilisi State Medical University'),
          college('David Tvildiani Medical University'),
          college('Batumi Shota Rustaveli State University'),
          college('University of Georgia, School of Health Sciences', 'university-of-georgia'),
          college('New Vision University'),
        ],
        4,
      ),
      exploreCountry(
        'Kazakhstan',
        8,
        [
          college('Asfendiyarov Kazakh National Medical University'),
          college('Astana Medical University'),
          college('Karaganda Medical University'),
          college('Semey Medical University'),
          college('Al-Farabi Kazakh National University'),
        ],
        4,
      ),
      exploreCountry(
        'Kyrgyzstan',
        8,
        [
          college('Kyrgyz State Medical Academy'),
          college('Osh State University'),
          college('Kyrgyz-Russian Slavic University'),
          college('International School of Medicine'),
          college('Asian Medical Institute'),
        ],
        4,
      ),
      exploreCountry(
        'Uzbekistan',
        5,
        [
          college('Tashkent State Medical University'),
          college('Samarkand State Medical University'),
          college('Bukhara State Medical Institute'),
          college('Andijan State Medical Institute'),
        ],
        4,
        { menu: 'NMC alert on some colleges', mobile: 'Alert' },
      ),
    ],
    nextCountries: ['Philippines', 'Nepal', 'Bangladesh'],
    indiaNote: 'Fees and closing ranks',
    states: [
      { ...state('Uttar Pradesh'), count: '[68]' },
      { ...state('Maharashtra'), count: null },
      { ...state('Rajasthan'), count: null },
      { ...state('Bihar'), count: null },
      { ...state('Madhya Pradesh'), count: null },
      { ...state('Karnataka'), count: null },
      { ...state('Tamil Nadu'), count: null },
      { ...state('Kerala'), count: null },
    ],
    findColleges: { ...collegeFinder, label: 'Find my colleges' },
  },

  dropdowns: [
    {
      id: 'dest',
      label: 'MBBS Destination',
      title: 'MBBS abroad',
      intro: 'Country guides with fees, NMC rules and the colleges we have checked.',
      primary: { ...collegeFinder, label: 'Find colleges for my rank' },
      columns: [
        {
          title: 'Central Asia',
          items: ['Kazakhstan', 'Kyrgyzstan', 'Uzbekistan', 'Tajikistan'].map(country),
        },
        {
          title: 'Europe',
          items: ['Russia', 'Georgia', 'Armenia', 'Poland', 'Romania', 'Hungary', 'Slovakia'].map(country),
        },
        {
          title: 'Asia and more',
          items: ['Nepal', 'Bangladesh', 'the Philippines', 'China', 'Vietnam', 'the Caribbean'].map(country),
        },
      ],
      mobileItems: [
        'Kazakhstan', 'Kyrgyzstan', 'Uzbekistan', 'Tajikistan', 'Russia', 'Georgia',
        'Armenia', 'Poland', 'Nepal', 'Bangladesh', 'the Philippines', 'China',
      ].map(country),
      seeAll: item('See all', '/mbbs-abroad'),
    },
    {
      id: 'ug',
      label: 'NEET UG 2026',
      title: 'NEET UG 2026',
      intro: 'Everything from the exam notice to counselling, checked against NTA and MCC notices.',
      primary: { ...rankPredictor, label: 'Check my likely rank' },
      columns: [
        {
          title: 'Exam info',
          items: [
            guide('NEET UG 2026 exam', 'neet-ug-2026'),
            guide('Exam dates', 'neet-ug-exam-dates'),
            guide('Exam pattern', 'neet-ug-exam-pattern'),
            guide('Syllabus', 'neet-ug-syllabus'),
            guide('Eligibility', 'neet-ug-eligibility'),
          ],
        },
        {
          title: 'Counselling',
          items: [
            guide('MCC All India Quota', 'mcc-all-india-quota'),
            ...['Uttar Pradesh', 'Bihar', 'Maharashtra', 'Rajasthan', 'Madhya Pradesh', 'Karnataka', 'Gujarat'].map(state),
          ],
        },
        {
          title: 'Results and tools',
          items: [
            rankPredictor,
            collegeFinder,
            guide('Cut-off 2026', 'neet-ug-cut-off-2026'),
            guide('Result 2026', 'neet-ug-result-2026'),
            guide('Answer key', 'neet-ug-answer-key'),
            guide('Admit card', 'neet-ug-admit-card'),
            guide('Previous year papers', 'neet-ug-previous-year-papers'),
          ],
        },
      ],
      mobileItems: [
        guide('NEET UG 2026 exam', 'neet-ug-2026'),
        guide('Exam dates', 'neet-ug-exam-dates'),
        guide('Exam pattern', 'neet-ug-exam-pattern'),
        guide('Syllabus', 'neet-ug-syllabus'),
        guide('MCC All India Quota', 'mcc-all-india-quota'),
        state('Uttar Pradesh'),
        state('Bihar'),
        state('Maharashtra'),
        rankPredictor,
        collegeFinder,
        guide('Cut-off 2026', 'neet-ug-cut-off-2026'),
        guide('Result 2026', 'neet-ug-result-2026'),
      ],
      seeAll: guide('See all', 'neet-ug'),
    },
    {
      id: 'pg',
      label: 'NEET PG 2026',
      title: 'NEET PG 2026',
      intro: 'Exam and counselling information for MBBS graduates going for MD, MS and diploma seats.',
      primary: { ...contact, label: 'Talk to a counsellor' },
      columns: [
        {
          title: 'Exam info',
          items: [
            guide('NEET PG 2026 exam', 'neet-pg-2026'),
            guide('Exam date', 'neet-pg-exam-date'),
            guide('Exam pattern', 'neet-pg-exam-pattern'),
            guide('Result', 'neet-pg-result'),
          ],
        },
        {
          title: 'Counselling',
          items: [
            guide('MCC NEET PG counselling', 'mcc-neet-pg-counselling'),
            ...['Maharashtra', 'Bihar', 'Karnataka', 'Uttar Pradesh', 'Madhya Pradesh', 'Rajasthan', 'West Bengal', 'Kerala'].map(
              (s) => guide(s, `neet-pg-counselling-${slugify(s)}`),
            ),
          ],
        },
        {
          title: 'Others',
          items: [
            guide('Admit card', 'neet-pg-admit-card'),
            guide('Syllabus', 'neet-pg-syllabus'),
            guide('Answer key', 'neet-pg-answer-key'),
            guide('Previous year papers', 'neet-pg-previous-year-papers'),
          ],
        },
      ],
      mobileItems: [
        guide('NEET PG 2026 exam', 'neet-pg-2026'),
        guide('Exam date', 'neet-pg-exam-date'),
        guide('Exam pattern', 'neet-pg-exam-pattern'),
        guide('Result', 'neet-pg-result'),
        guide('MCC NEET PG counselling', 'mcc-neet-pg-counselling'),
        guide('Maharashtra', 'neet-pg-counselling-maharashtra'),
        guide('Bihar', 'neet-pg-counselling-bihar'),
        guide('Karnataka', 'neet-pg-counselling-karnataka'),
        guide('Admit card', 'neet-pg-admit-card'),
        guide('Syllabus', 'neet-pg-syllabus'),
        guide('Answer key', 'neet-pg-answer-key'),
        guide('Previous year papers', 'neet-pg-previous-year-papers'),
      ],
      seeAll: guide('See all', 'neet-pg'),
    },
    {
      id: 'exams',
      label: 'Exams',
      title: 'Exams',
      intro: 'The entrance exams before MBBS and the licensing exams after it, in plain words.',
      primary: { ...contact, label: 'Talk to a counsellor' },
      columns: [
        {
          title: 'After MBBS abroad',
          items: [
            guide('FMGE: the screening test', 'fmge'),
            guide('FMGE dates and pass rates', 'fmge-dates-and-pass-rates'),
            guide('NExT: what changes', 'next-exam'),
            guide('Internship in India', 'internship-in-india'),
          ],
        },
        {
          title: 'Entrance exams',
          items: [guide('NEET UG', 'neet-ug'), guide('NEET PG', 'neet-pg'), guide('INI-CET', 'ini-cet')],
        },
        {
          title: 'Help',
          items: [
            guide('How to prepare', 'how-to-prepare'),
            guide('Mock tests', 'mock-tests'),
            guide('Previous year papers', 'previous-year-papers'),
          ],
        },
      ],
      mobileItems: [
        guide('FMGE: the screening test', 'fmge'),
        guide('FMGE dates and pass rates', 'fmge-dates-and-pass-rates'),
        guide('NExT: what changes', 'next-exam'),
        guide('Internship in India', 'internship-in-india'),
        guide('NEET UG', 'neet-ug'),
        guide('NEET PG', 'neet-pg'),
        guide('INI-CET', 'ini-cet'),
        guide('How to prepare', 'how-to-prepare'),
        guide('Mock tests', 'mock-tests'),
        guide('Previous year papers', 'previous-year-papers'),
      ],
      seeAll: guide('See all', 'exams'),
    },
  ],

  tools: [
    { icon: 'chart', item: rankPredictor },
    { icon: 'college', item: collegeFinder },
    { icon: 'scale', item: compare },
    { icon: 'book', item: guides },
  ],
  about,
  contact,
  counsellingCall: { ...contact, label: 'Free counselling call' },
  whatsappExpert: { ...contact, label: 'WhatsApp an expert' },

  footer: [
    {
      title: 'Tools',
      items: [{ ...rankPredictor, label: 'NEET Rank Predictor' }, collegeFinder, compare],
    },
    {
      title: 'Study MBBS',
      items: [
        country('Russia'),
        country('Kazakhstan'),
        country('Georgia'),
        item('NEET counselling by state', '/neet-counselling'),
        item('All countries', '/mbbs-abroad'),
      ],
    },
    {
      title: 'About',
      items: [
        { ...about, label: 'About us' },
        item('How we check colleges', '/about#how-we-check'),
        contact,
        item('Privacy policy', '/privacy'),
        item('Terms', '/terms'),
        item('Grievance officer', '/contact#grievance'),
      ],
    },
  ],

  tabs: [
    { icon: 'chart', label: 'Rank', item: rankPredictor },
    { icon: 'college', label: 'Colleges', item: collegeFinder },
    { icon: 'book', label: 'Guides', item: guides },
    { icon: 'chat', label: 'Talk to us', item: contact, talk: true },
  ],
}

/** Menu, footer and tab bar data. SAMPLE until GET /navigation/explore exists. */
export async function getNavigation(): Promise<Navigation> {
  return SAMPLE_NAVIGATION
}
