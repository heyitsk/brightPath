import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useLocation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { CollegeStatusBadge } from '../../components/admin/colleges/components'
import {
  feeYears,
  KIND_OPTIONS,
  inr,
  loadCountryOptions,
  loadStateOptions,
  num,
  STATUS_OPTIONS,
} from '../../components/admin/colleges/data'
import type { CollegeList, CollegeListItem, Kind, Status } from '../../components/admin/colleges/types'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { Opt } from '../../components/admin/crud/types'
import { formatNumber } from '../../components/shared/format'
import { EmptyState, Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/colleges'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Colleges | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const PAGE = 50
const FILTERS = ['q', 'kind', 'status', 'countryId', 'stateId'] as const
/** Lets the five filters share one row when there is room (the default .adm-filters minimum is 180px). */
const FIELD_STYLE = { flex: '1 1 130px', minWidth: 130 }

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams
  const get = (k: string) => sp.get(k) || undefined
  const cursor = get('cursor')
  const list = loadOrThrow<CollegeList>(
    adminApi.GET('/admin/colleges', {
      params: {
        query: {
          q: get('q'),
          kind: get('kind') as Kind | undefined,
          status: get('status') as Status | undefined,
          countryId: get('countryId'),
          stateId: get('stateId'),
          limit: PAGE,
          cursor,
        },
      },
    }),
  )
  // "Load more" only needs the next rows, not the filter choices again.
  const [data, countries, states] = await Promise.all([
    list,
    cursor ? ([] as Opt[]) : loadCountryOptions(),
    cursor ? ([] as Opt[]) : loadStateOptions(),
  ])
  const query: Record<string, string> = {}
  for (const k of FILTERS) if (sp.get(k)) query[k] = sp.get(k) as string
  return { data, countries, states, query, saved: sp.get('saved') }
}

export default function Colleges({ loaderData }: Route.ComponentProps) {
  const { data, countries, states, query, saved } = loaderData
  const { search } = useLocation()
  const filtered = Object.keys(query).length > 0
  // The inputs are uncontrolled, so put the URL's values back in after each navigation
  // (e.g. "Clear"). Not done with a `key` on the form: remounting it left stale copies in the DOM.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    for (const k of FILTERS) {
      const el = form.elements.namedItem(k)
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = query[k] ?? ''
    }
  }, [query])
  const select = (name: string, label: string, options: Opt[]) => (
    <div className="field" style={FIELD_STYLE}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <select className="select" id={`f-${name}`} name={name} defaultValue={query[name] ?? ''}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <>
      <PageHead title="Colleges" action={{ to: '/admin/colleges/new', label: 'New college' }} />
      {saved === 'deleted' && <Flash>College deleted.</Flash>}

      <Form method="get" className="adm-filters" ref={formRef}>
        <div className="field" style={{ ...FIELD_STYLE, flexBasis: 180 }}>
          <label htmlFor="f-q">Search</label>
          <input className="input" id="f-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="Name or city" />
        </div>
        {select('kind', 'Kind', KIND_OPTIONS)}
        {select('status', 'Status', STATUS_OPTIONS)}
        {select('countryId', 'Country', countries)}
        {select('stateId', 'State', states)}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        {filtered && (
          <Link className="btn btn-secondary" to="/admin/colleges">
            Clear
          </Link>
        )}
      </Form>

      <p style={{ marginTop: 16 }}>
        {formatNumber(num(data.total) ?? 0)} {num(data.total) === 1 ? 'college matches' : 'colleges match'}.
      </p>
      {data.items.length === 0 ? (
        <EmptyState items="colleges" filtered={filtered} />
      ) : (
        <Results key={search} first={data.items} firstCursor={data.nextCursor} query={query} />
      )}
    </>
  )
}

type Page = Route.ComponentProps['loaderData']

/** The table plus "Load more": fetched pages are appended; new filters remount it (key). */
function Results(props: { first: CollegeListItem[]; firstCursor: string | null; query: Record<string, string> }) {
  const { first, firstCursor, query } = props
  const fetcher = useFetcher<Page>()
  const [kept, setKept] = useState<CollegeListItem[]>([])
  const loading = fetcher.state !== 'idle'
  // While the next page loads, the previous fetch is already in `kept`, so do not show it twice.
  const latest = !loading && fetcher.data ? fetcher.data.data : null
  const items = [...first, ...kept, ...(latest?.items ?? [])]
  const cursor = fetcher.data ? fetcher.data.data.nextCursor : firstCursor

  const more = () => {
    if (!cursor) return
    if (latest) setKept((k) => [...k, ...latest.items])
    const p = new URLSearchParams(query)
    p.set('cursor', cursor)
    fetcher.load(`/admin/colleges?${p.toString()}`)
  }

  return (
    <>
      <div className="tbl-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th className="hide-sm">City</th>
              <th>Country or state</th>
              <th>Status</th>
              <th className="hide-sm">Total fee</th>
              <th>Ready check</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const missing = num(c.readiness.missingCount) ?? 0
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/colleges/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="hide-sm">{c.city}</td>
                  <td>{(c.kind === 'INDIA' ? c.state?.name : c.country?.name) ?? '-'}</td>
                  <td>
                    <CollegeStatusBadge status={c.status} />
                  </td>
                  <td className="hide-sm">{inr(c.totalCourseFeeInr)}</td>
                  <td>
                    {missing === 0 ? 'Complete' : `${missing} missing`}
                    <span className="hint" style={{ display: 'block', margin: 0 }}>
                      Fee years {feeYears(c.readiness)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {cursor && (
        <p className="adm-pager">
          <button className="btn btn-secondary" type="button" onClick={more} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </p>
      )}
    </>
  )
}
