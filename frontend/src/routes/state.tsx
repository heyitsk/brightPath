import { data } from 'react-router'
import { PageError } from '../components/shared/PageError'
import { StatePage } from '../components/state/StatePage'
import { getStateCounselling } from '../data/states'
import stateStyles from '../styles/pages/state.css?url'
import type { Route } from './+types/state'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: stateStyles }]

/** The only data call on this page. Switching to the real API means changing getStateCounselling(). */
export async function loader({ params }: Route.LoaderArgs) {
  const detail = await getStateCounselling(params.state)
  if (!detail) {
    throw data({ code: 'STATE_NOT_FOUND', message: 'We do not have a counselling page for that state yet.' }, { status: 404 })
  }
  return detail
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: detail }) => {
  if (!detail) return [{ title: 'State not found' }]
  const { state, colleges } = detail
  return [
    { title: `NEET UG counselling in ${state.name}: colleges, fees and closing ranks` },
    {
      name: 'description',
      content: `How state quota MBBS seats are filled in ${state.name}: who runs counselling, who can apply, the steps, and fees and past closing ranks for ${colleges.length} ${colleges.length === 1 ? 'college' : 'colleges'}.`,
    },
  ]
}

export default function StateCounselling({ loaderData }: Route.ComponentProps) {
  return <StatePage detail={loaderData} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="State not found" />
}
