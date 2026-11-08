import { useNavigation } from 'react-router'
import { api } from '../api/client.server'
import { safeCall } from '../api/errors'
import type { components } from '../api/schema'
import { DataSources } from '../components/rank/DataSources'
import { isValidScore, PATH, type Category, type DataSourceYear, type RankError } from '../components/rank/labels'
import { RankForm, type RankQuery } from '../components/rank/RankForm'
import { RankResult } from '../components/rank/RankResult'
import { Crumbs } from '../components/shared/Crumbs'
import { HOME } from '../components/shared/home'
import { PageError } from '../components/shared/PageError'
import rankStyles from '../styles/pages/rank.css?url'
import type { Route } from './+types/rank-predictor'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: rankStyles }]

export const meta: Route.MetaFunction = () => [
  { title: 'NEET Rank Predictor: likely All-India rank from official NTA results' },
  {
    name: 'description',
    content:
      'Enter your NEET UG score and category to see the All-India rank range students with your marks got, looked up in official NTA results, with the source and the date we checked it.',
  },
]

// Same answer for the same URL, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

type ErrorBody = Partial<components['schemas']['ErrorEnvelope']>

/** Plain wording for the fields the API validates; its own messages are technical ("Expected union value"). */
const FIELD_HELP: Record<string, string> = {
  score: 'Enter a whole number from -180 to 720.',
  category: 'Choose General, EWS, OBC, SC or ST.',
  year: 'Results for that year are not available. Choose a year from the list.',
}

function toRankError(status: number, error: unknown, query: RankQuery): RankError {
  const body = (error as ErrorBody | undefined)?.error
  const fields: Record<string, string> = {}
  const other: string[] = []
  for (const f of body?.fields ?? []) {
    if (FIELD_HELP[f.path]) fields[f.path] ??= FIELD_HELP[f.path]
    else other.push(f.message)
  }
  // Some range errors come back without a field path; the score is the only free-text field.
  if (status === 422 && !fields.score && !isValidScore(query.score)) fields.score = FIELD_HELP.score

  let message: string
  if (status === 404) message = body?.message ?? 'NEET rank data has not been published yet.'
  else if (status === 422) {
    // Our own wording when we know the field; otherwise the API's messages as given.
    const known = Object.values(fields)
    const problems = known.length ? known : other
    message = `We could not look up that score. ${problems.join(' ') || body?.message || 'Please check your details.'}`
  } else if (status === 429) message = 'Too many requests. Please wait a moment and try again.'
  else if (status === 0) message = 'Could not reach the server. Check your connection and try again.'
  else message = 'The server had a problem looking up your rank. Please try again in a moment.'
  return { status, code: body?.code, message, fields }
}

const TRUE = new Set(['1', 'true', 'on'])

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const query: RankQuery = {
    score: (url.searchParams.get('score') ?? '').trim(),
    category: url.searchParams.get('category') ?? '',
    pwd: TRUE.has(url.searchParams.get('pwd') ?? ''),
    year: (url.searchParams.get('year') ?? '').trim(),
  }

  const sourcesCall = safeCall(api.GET('/neet/data-sources'))
  const rankCall = query.score
    ? safeCall(
        api.GET('/neet/rank', {
          params: {
            query: {
              score: query.score,
              // An unknown category is sent as is so the API answers with its own 422.
              category: (query.category || 'GENERAL') as Category,
              ...(query.pwd ? { pwd: true } : {}),
              ...(query.year ? { year: query.year } : {}),
            },
          },
        }),
      )
    : null

  const [sources, rank] = await Promise.all([sourcesCall, rankCall])

  let years: DataSourceYear[] = []
  let sourcesError: string | null = null
  if ('data' in sources && sources.data) years = sources.data.years
  else
    sourcesError =
      sources.response.status === 0
        ? 'Could not reach the server, so the data sources cannot be listed right now.'
        : 'We could not load the data sources. Please try again in a moment.'

  let rankData = null
  let rankError: RankError | null = null
  if (rank) {
    if ('data' in rank && rank.data) rankData = rank.data
    else rankError = toRankError(rank.response.status, rank.error, query)
  }

  return { query, years, sourcesError, rank: rankData, rankError }
}

export default function RankPredictor({ loaderData }: Route.ComponentProps) {
  const { query, years, sourcesError, rank, rankError } = loaderData
  const navigation = useNavigation()
  const busy = navigation.state === 'loading' && navigation.location.pathname === PATH

  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME]} current="NEET Rank Predictor" />
        <header className="page-head">
          <h1>NEET Rank Predictor</h1>
          <p className="lead">
            Enter your NEET UG score. We look it up against official NTA results and show the All-India rank range
            students with your marks got.
          </p>
        </header>
      </div>

      <section className="wrap tool" style={{ paddingBottom: 56 }}>
        <RankForm query={query} years={years} fieldErrors={rankError?.fields ?? {}} busy={busy} />

        <div className="res-grid" aria-live="polite" aria-busy={busy || undefined}>
          {busy && (
            <p className="res-status" role="status">
              Looking up your rank…
            </p>
          )}
          {rank ? (
            <RankResult data={rank} />
          ) : rankError ? (
            <div className="callout" role="alert" style={{ margin: 0 }}>
              <h3>{rankError.status === 404 ? 'No results to compare with yet' : 'We could not show a rank'}</h3>
              <p>{rankError.message}</p>
            </div>
          ) : (
            <div className="callout" style={{ margin: 0 }}>
              <h3>Your result will appear here</h3>
              <p>Enter your score and category to see your likely All-India rank range.</p>
            </div>
          )}
        </div>
      </section>

      <hr className="perf" />
      <DataSources years={years} error={sourcesError} />
    </>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="Page not found" />
}
