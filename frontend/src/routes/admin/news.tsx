import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useLocation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { Opt } from '../../components/admin/crud/types'
import { OriginalLink } from '../../components/admin/news/components'
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  dateLine,
  isCategory,
  isStatus,
  loadSourceChoices,
  loadStateChoices,
  n,
  placeLabel,
  shortDateLine,
  shorten,
  STATUS_LABEL,
  STATUSES,
} from '../../components/admin/news/data'
import type { BulkAction, BulkResult, NewsList, NewsListItem, NewsStatus } from '../../components/admin/news/types'
import { Flash, PageHead } from '../../components/admin/staff/common'
import { formatNumber } from '../../components/shared/format'
import type { Route } from './+types/news'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'News review | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const PAGE = 50
const BULK_MAX = 100
const FILTERS = ['q', 'stateId', 'central', 'category', 'sourceId', 'hideRepeats'] as const
const CHECKBOXES = new Set<string>(['central', 'hideRepeats'])
const FIELD_STYLE = { flex: '1 1 150px', minWidth: 150 }

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams
  const get = (k: string) => sp.get(k) || undefined
  const rawStatus = sp.get('status')
  const status: NewsStatus = isStatus(rawStatus) ? rawStatus : 'PENDING'
  const category = get('category')
  const cursor = get('cursor')
  const list = loadOrThrow<NewsList>(
    adminApi.GET('/admin/news/items', {
      params: {
        query: {
          status,
          q: get('q'),
          stateId: get('stateId'),
          central: sp.get('central') === 'true' ? true : undefined,
          category: isCategory(category) ? category : undefined,
          sourceId: get('sourceId'),
          hideRepeats: sp.get('hideRepeats') === 'true' ? true : undefined,
          limit: PAGE,
          cursor,
        },
      },
    }),
  )
  // "Load more" only needs the next rows, not the filter choices again.
  const [data, states, sources] = await Promise.all([
    list,
    cursor ? null : loadStateChoices(),
    cursor ? null : loadSourceChoices(),
  ])
  const query: Record<string, string> = {}
  for (const k of FILTERS) if (sp.get(k)) query[k] = sp.get(k) as string
  return { data, states, sources, status, query }
}

type BulkDone = { ok: true; action: BulkAction; ids: string[]; result: BulkResult }
type BulkFailed = { ok: false; failure: ApiFailure }

/** Bulk reject or restore. Publishing is never done in bulk. */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<BulkDone | BulkFailed> {
  const form = await request.formData()
  const action = form.get('action')
  const ids = form.getAll('ids').map(String).filter(Boolean)
  const fail = (formError: string): BulkFailed => ({ ok: false, failure: { status: 0, formError, fieldErrors: {} } })
  if (action !== 'reject' && action !== 'restore') return fail('Unknown action.')
  if (ids.length === 0) return fail('Tick at least one notice.')
  if (ids.length > BULK_MAX) return fail(`At most ${BULK_MAX} notices at a time.`)
  const result = await safeCall(adminApi.POST('/admin/news/items/bulk', { body: { ids, action } }))
  const data = (result as { data?: BulkResult }).data
  if (result.response.ok && data) return { ok: true, action, ids, result: data }
  return { ok: false, failure: handleApiError(result) }
}

export default function News({ loaderData }: Route.ComponentProps) {
  const { data, states, sources, status, query } = loaderData
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
      if (el instanceof HTMLInputElement && CHECKBOXES.has(k)) el.checked = query[k] === 'true'
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = query[k] ?? ''
    }
  }, [query])

  const select = (name: string, label: string, options: Opt[], any = 'Any') => (
    <div className="field" style={FIELD_STYLE}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <select className="select" id={`f-${name}`} name={name} defaultValue={query[name] ?? ''}>
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
  const check = (name: string, label: string) => (
    <div className="field" style={{ minWidth: 0 }}>
      <label className="check" htmlFor={`f-${name}`}>
        <input type="checkbox" id={`f-${name}`} name={name} value="true" defaultChecked={query[name] === 'true'} />
        <span>{label}</span>
      </label>
    </div>
  )
  const tabHref = (s: NewsStatus) => `?${new URLSearchParams({ ...query, status: s }).toString()}`

  return (
    <>
      <PageHead title="News review" />
      <p className="hint" style={{ marginTop: 8 }}>
        Notices found on official admission and counselling sites. Nothing reaches the public News page until a staff
        member checks it against the official notice and publishes it.
      </p>

      <nav aria-label="News status" className="adm-actions adm-tabs" style={{ marginTop: 16 }}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            className="btn btn-secondary"
            to={tabHref(s)}
            aria-current={s === status ? 'page' : undefined}
          >
            {STATUS_LABEL[s]} ({formatNumber(n(data.counts[s]))})
          </Link>
        ))}
      </nav>

      <Form method="get" className="adm-filters" ref={formRef}>
        <input type="hidden" name="status" value={status} />
        <div className="field" style={{ ...FIELD_STYLE, flexBasis: 200 }}>
          <label htmlFor="f-q">Search</label>
          <input className="input" id="f-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="Words in the title" />
        </div>
        {states && select('stateId', 'State', states)}
        {select('category', 'Category', CATEGORY_OPTIONS)}
        {sources && select('sourceId', 'Source', sources)}
        {check('central', 'Central only')}
        {check('hideRepeats', 'Hide repeats')}
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        {filtered && (
          <Link className="btn btn-secondary" to={`?status=${status}`}>
            Clear
          </Link>
        )}
      </Form>

      {data.items.length === 0 ? (
        <p style={{ marginTop: 24 }}>
          {filtered ? 'No notices match these filters.' : status === 'PENDING' ? 'Nothing to review.' : 'No notices here.'}
        </p>
      ) : (
        <Results key={search} first={data.items} firstCursor={data.nextCursor} query={query} status={status} />
      )}
    </>
  )
}

type Page = Route.ComponentProps['loaderData']

const notices = (count: number) => `${formatNumber(count)} ${count === 1 ? 'notice' : 'notices'}`

function bulkMessage({ action, result }: BulkDone): string {
  const done = n(result.updated)
  const head = action === 'reject' ? `Rejected ${notices(done)}.` : `Sent ${notices(done)} back to review.`
  const skipped = result.skipped.length
  return skipped === 0 ? head : `${head} ${notices(skipped)} skipped:`
}

/** The table, bulk actions and "Load more": fetched pages are appended; new filters remount it (key). */
function Results(props: { first: NewsListItem[]; firstCursor: string | null; query: Record<string, string>; status: NewsStatus }) {
  const { first, firstCursor, query, status } = props
  const fetcher = useFetcher<Page>()
  const bulk = useFetcher<typeof clientAction>()
  const [kept, setKept] = useState<NewsListItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // Notices a bulk action moved out of this tab; hidden at once, also from pages loaded earlier.
  const [gone, setGone] = useState<Set<string>>(() => new Set())
  const [seenResult, setSeenResult] = useState<typeof bulk.data>(undefined)

  const result = bulk.state === 'idle' ? bulk.data : undefined
  if (result !== seenResult) {
    setSeenResult(result)
    if (result?.ok) {
      const skipped = new Set(result.result.skipped.map((s) => s.id))
      setGone((g) => new Set([...g, ...result.ids.filter((id) => !skipped.has(id))]))
      setSelected(new Set())
    }
  }

  const loading = fetcher.state !== 'idle'
  // While the next page loads, the previous fetch is already in `kept`, so do not show it twice.
  const latest = !loading && fetcher.data ? fetcher.data.data : null
  const all = [...first, ...kept, ...(latest?.items ?? [])]
  const items = all.filter((i) => !gone.has(i.id))
  const cursor = fetcher.data ? fetcher.data.data.nextCursor : firstCursor
  const titleOf = (id: string) => all.find((i) => i.id === id)?.title ?? 'A notice'

  const more = () => {
    if (!cursor) return
    if (latest) setKept((k) => [...k, ...latest.items])
    const p = new URLSearchParams({ ...query, status })
    p.set('cursor', cursor)
    fetcher.load(`/admin/news?${p.toString()}`)
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const allTicked = items.length > 0 && items.every((i) => selected.has(i.id))
  const toggleAll = (on: boolean) => setSelected(on ? new Set(items.map((i) => i.id)) : new Set())

  const ticked = items.filter((i) => selected.has(i.id)).map((i) => i.id)
  const busy = bulk.state !== 'idle'
  const tooMany = ticked.length > BULK_MAX
  const send = (action: BulkAction) => {
    const body = new FormData()
    body.set('action', action)
    for (const id of ticked) body.append('ids', id)
    bulk.submit(body, { method: 'post', action: '/admin/news' })
  }
  // Rejecting fits notices not yet decided; restoring fits filtered, old, rejected and unpublished ones.
  const canReject = status !== 'REJECTED' && status !== 'PUBLISHED'
  const canRestore = status !== 'PENDING' && status !== 'PUBLISHED'

  return (
    <>
      {result?.ok && (
        <Flash>{bulkMessage(result)}</Flash>
      )}
      {result?.ok && result.result.skipped.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {result.result.skipped.map((s) => (
            <li key={s.id}>
              {titleOf(s.id)}: {s.reason}
            </li>
          ))}
        </ul>
      )}
      {result && !result.ok && (
        <div style={{ marginTop: 16 }}>
          <FormError message={result.failure.formError} />
        </div>
      )}

      {(canReject || canRestore) && (
        <div className="adm-actions" style={{ marginTop: 16, alignItems: 'center' }}>
          {canReject && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => send('reject')}
              disabled={busy || ticked.length === 0 || tooMany}
            >
              Reject selected
            </button>
          )}
          {canRestore && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => send('restore')}
              disabled={busy || ticked.length === 0 || tooMany}
            >
              Send back to review
            </button>
          )}
          <span className="hint" style={{ margin: 0 }} role="status">
            {busy
              ? 'Working…'
              : tooMany
                ? `${formatNumber(ticked.length)} ticked. At most ${BULK_MAX} at a time.`
                : `${formatNumber(ticked.length)} ticked.`}{' '}
            Publishing is done one notice at a time.
          </span>
        </div>
      )}

      <div className="tbl-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 1 }}>
                <input
                  type="checkbox"
                  aria-label="Tick every notice shown"
                  checked={allTicked}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <th scope="col">Notice</th>
              <th scope="col" className="hide-sm">
                Source
              </th>
              <th scope="col">State</th>
              <th scope="col" className="hide-sm">
                Category
              </th>
              <th scope="col">Date</th>
              <th scope="col" className="hide-sm">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Tick “${item.title}”`}
                    checked={selected.has(item.id)}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                  />
                </td>
                <td>
                  <Link to={`/admin/news/${item.id}`}>{item.title}</Link>
                  {item.duplicateOf && (
                    <span className="hint" style={{ display: 'block', margin: 0 }}>
                      Repeat of “{shorten(item.duplicateOf.title)}” ({STATUS_LABEL[item.duplicateOf.status].toLowerCase()})
                    </span>
                  )}
                  <span style={{ display: 'block', marginTop: 4 }}>
                    <OriginalLink href={item.originalUrl}>Official original</OriginalLink>
                  </span>
                </td>
                <td className="hide-sm">{item.source.name}</td>
                <td>{placeLabel(item)}</td>
                <td className="hide-sm">{CATEGORY_LABEL[item.category]}</td>
                <td style={{ whiteSpace: 'nowrap' }} title={dateLine(item)}>
                  {shortDateLine(item)}
                </td>
                <td className="hide-sm">{n(item.relevance.score)}</td>
              </tr>
            ))}
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
