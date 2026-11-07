import { data } from 'react-router'
import { AbroadCollege } from '../components/college/AbroadCollege'
import { IndiaCollege } from '../components/college/IndiaCollege'
import { PageError } from '../components/shared/PageError'
import { formatLakh } from '../components/shared/format'
import { getCollege, isAbroad } from '../data/colleges'
import collegeStyles from '../styles/pages/college.css?url'
import type { Route } from './+types/college'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: collegeStyles }]

/** The only data call on this page. Switching to the real API means changing getCollege(). */
export async function loader({ params }: Route.LoaderArgs) {
  const detail = await getCollege(params.slug)
  if (!detail) {
    throw data({ code: 'COLLEGE_NOT_FOUND', message: 'We could not find that college.' }, { status: 404 })
  }
  return detail
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: detail }) => {
  if (!detail) return [{ title: 'College not found' }]
  const { college } = detail
  if (isAbroad(detail)) {
    const total = detail.totalCourseFeeInr ? `, ${formatLakh(detail.totalCourseFeeInr)} total for the whole course` : ''
    return [
      { title: `${college.name}, ${detail.countryName}: MBBS fees and recognition` },
      {
        name: 'description',
        content: `${college.name} in ${college.city}, ${detail.countryName}. WDOMS listing, NMC 2021 rules check, NMC alerts and fees year by year${total}. Each fact shows the date it was checked.`,
      },
    ]
  }
  return [
    { title: `${college.name}, ${college.city}: MBBS seats, fees and closing ranks` },
    {
      name: 'description',
      content: `${college.name} in ${college.city}, ${detail.stateName}. ${detail.indiaProfile.mbbsSeats} MBBS seats, fees, past closing ranks and how to get a seat. Each fact shows the date it was checked.`,
    },
  ]
}

export default function College({ loaderData }: Route.ComponentProps) {
  return isAbroad(loaderData) ? <AbroadCollege detail={loaderData} /> : <IndiaCollege detail={loaderData} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="College not found" />
}
