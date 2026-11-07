import { data } from 'react-router'
import { CountryPage } from '../components/country/CountryPage'
import { PageError } from '../components/shared/PageError'
import { getCountry } from '../data/countries'
import countryStyles from '../styles/pages/country.css?url'
import type { Route } from './+types/country'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: countryStyles }]

/** The only data call on this page. Switching to the real API means changing getCountry(). */
export async function loader({ params }: Route.LoaderArgs) {
  const detail = await getCountry(params.country)
  if (!detail) {
    throw data({ code: 'COUNTRY_NOT_FOUND', message: 'We do not have a page for that country yet.' }, { status: 404 })
  }
  return detail
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: detail }) => {
  if (!detail) return [{ title: 'Country not found' }]
  const { country, content } = detail
  return [
    { title: `MBBS in ${country.name}: fees, NMC rules and colleges we have checked` },
    { name: 'description', content: content.intro },
  ]
}

export default function Country({ loaderData }: Route.ComponentProps) {
  return <CountryPage detail={loaderData} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="Country not found" />
}
