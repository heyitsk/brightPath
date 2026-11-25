import { data } from 'react-router'
import { CountryPage } from '../components/country/CountryPage'
import { PageError } from '../components/shared/PageError'
import { listColleges } from '../data/colleges'
import { getCountry } from '../data/countries'
import countryStyles from '../styles/pages/country.css?url'
import type { Route } from './+types/country'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: countryStyles }]

/** This page still shows SAMPLE content (see root.tsx). */
export const handle = {
  sample: 'The country facts, costs and questions on this page are sample text and have not been checked yet. The colleges listed are real.',
}

/** Country content (SAMPLE until phase 7, see getCountry()) plus its listed colleges from the API. */
export async function loader({ params }: Route.LoaderArgs) {
  const detail = await getCountry(params.country)
  if (!detail) {
    throw data({ code: 'COUNTRY_NOT_FOUND', message: 'We do not have a page for that country yet.' }, { status: 404 })
  }
  const list = await listColleges({ kind: 'ABROAD', country: detail.country.slug })
  return { ...detail, colleges: list.items, collegesTotal: Number(list.total) }
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
