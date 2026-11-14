import { data } from 'react-router'
import { AbroadCollege } from '../components/college/AbroadCollege'
import { IndiaCollege } from '../components/college/IndiaCollege'
import { PageError } from '../components/shared/PageError'
import { formatLakh } from '../components/shared/format'
import { isAbroad, isIndia } from '../components/college/college-data'
import { getCollege } from '../data/colleges'
import collegeStyles from '../styles/pages/college.css?url'
import type { Route } from './+types/college'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: collegeStyles }]

const notFound = () => data({ code: 'COLLEGE_NOT_FOUND', message: 'We could not find that college.' }, { status: 404 })

/** The only data call on this page: GET /colleges/{slug}. Unknown or unlisted colleges are a 404. */
export async function loader({ params }: Route.LoaderArgs) {
  const college = await getCollege(params.slug)
  if (!college || !(isAbroad(college) || isIndia(college))) throw notFound()
  return college
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: college }) => {
  if (!college) return [{ title: 'College not found' }]
  if (isAbroad(college)) {
    const country = college.country?.name ?? ''
    const total =
      college.totalCourseFeeInr != null ? `, ${formatLakh(Number(college.totalCourseFeeInr))} total for the whole course` : ''
    return [
      { title: `${college.name}, ${country}: MBBS fees and recognition` },
      {
        name: 'description',
        content: `${college.name} in ${college.city}, ${country}. WDOMS listing, NMC 2021 rules check, NMC alerts and fees year by year${total}. Each fact shows the date it was checked.`,
      },
    ]
  }
  const seats = college.india?.mbbsSeats != null ? `${Number(college.india.mbbsSeats)} MBBS seats, ` : ''
  return [
    { title: `${college.name}, ${college.city}: MBBS seats and fees` },
    {
      name: 'description',
      content: `${college.name} in ${college.city}, ${college.state?.name ?? ''}. ${seats}fees, hospital and how to get a seat. Each fact shows the date it was checked.`,
    },
  ]
}

export default function College({ loaderData: college }: Route.ComponentProps) {
  if (isAbroad(college)) return <AbroadCollege college={college} />
  if (isIndia(college)) return <IndiaCollege college={college} />
  return null
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="College not found" />
}
