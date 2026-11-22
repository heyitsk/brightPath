import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useFetcher, useRevalidator } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { Facts } from '../../components/admin/neet/common'
import { HealthBadge, OnOffBadge, OriginalLink } from '../../components/admin/news/components'
import { CATEGORY_LABEL, isCategory, loadStateChoices, n } from '../../components/admin/news/data'
import { SourceForm, type SourceFormFailure } from '../../components/admin/news/SourceForm'
import {
  formatDateTime,
  formatDuration,
  KIND_LABEL,
  OUTCOME_LABEL,
  placeOf,
  readSourceForm,
  sourceChanges,
  SOURCES_HREF,
  withConfigErrors,
} from '../../components/admin/news/sources'
import type { NewsSource, SourceRun, SourceRuns, TestItem, TestResult } from '../../components/admin/news/types'
import { Flash } from '../../components/admin/staff/common'
import { formatDate, formatNumber } from '../../components/shared/format'
import type { Route } from './+types/news-source'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'News source | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const RUNS_SHOWN = 20
const POLL_MS = 3_000
const POLL_FOR_MS = 60_000

async function loadSource(id: string): Promise<NewsSource> {
  const data = await loadOrThrow<{ source: NewsSource }>(
    adminApi.GET('/admin/news/sources/{id}', { params: { path: { id } } }),
  )
  return data.source
}

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const [source, states, runs] = await Promise.all([
    loadSource(params.id),
    loadStateChoices(),
    loadOrThrow<SourceRuns>(
      adminApi.GET('/admin/news/sources/{id}/runs', { params: { path: { id: params.id }, query: { limit: RUNS_SHOWN } } }),
    ),
  ])
  return { source, states, runs: runs.items, saved: new URL(request.url).searchParams.get('saved') }
}

type SaveResult = { intent: 'save'; ok: true } | { intent: 'save'; ok: false; failure: SourceFormFailure }
type TestOutcome = { intent: 'test'; ok: true; result: TestResult } | { intent: 'test'; ok: false; failure: ApiFailure }
type RunQueued = { intent: 'run'; ok: true; previousTopRunId: string | null }
type RunOutcome = RunQueued | { intent: 'run'; ok: false; failure: ApiFailure }

/** Save (only changed fields), Test (dry run, stores nothing) and Fetch now (only queues the fetch). */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<SaveResult | TestOutcome | RunOutcome> {
  const form = await request.formData()
  const intent = form.get('intent')
  const path = { id: params.id }

  if (intent === 'test') {
    const result = await safeCall(adminApi.POST('/admin/news/sources/{id}/test', { params: { path } }))
    const data = (result as { data?: TestResult }).data
    if (result.response.ok && data) return { intent, ok: true, result: data }
    return { intent, ok: false, failure: handleApiError(result) }
  }

  if (intent === 'run') {
    // The worker does the fetch; the page watches Recent runs for a run newer than this one.
    const previousTopRunId = String(form.get('previousTopRunId') ?? '') || null
    const result = await safeCall(adminApi.POST('/admin/news/sources/{id}/run', { params: { path } }))
    if (result.response.ok) return { intent, ok: true, previousTopRunId }
    return { intent, ok: false, failure: handleApiError(result) }
  }

  const { values, fieldErrors } = readSourceForm(form)
  if (Object.keys(fieldErrors).length > 0) {
    return { intent: 'save', ok: false, failure: { formError: 'Please fix the highlighted fields.', fieldErrors } }
  }
  // Compared with a fresh copy, not the page, so another person's change is not undone.
  const body = sourceChanges(values, await loadSource(params.id))
  if (Object.keys(body).length === 0) {
    return { intent: 'save', ok: false, failure: { formError: 'Nothing was changed.', fieldErrors: {} } }
  }
  const result = await safeCall(adminApi.PATCH('/admin/news/sources/{id}', { params: { path }, body }))
  if (result.response.ok) return { intent: 'save', ok: true }
  const failure = handleApiError(result)
  return {
    intent: 'save',
    ok: false,
    failure: { formError: failure.formError, fieldErrors: withConfigErrors(failure.fieldErrors) },
  }
}

const notices = (count: number) => `${formatNumber(count)} ${count === 1 ? 'notice' : 'notices'}`
const when = (iso: string | null) => (iso ? formatDateTime(iso) : 'Never')

export default function NewsSourcePage({ loaderData, actionData }: Route.ComponentProps) {
  const { source, states, runs, saved } = loaderData
  const save = actionData?.intent === 'save' ? actionData : undefined
  const stored = n(source.itemCount)
  const waiting = n(source.pendingCount)

  const facts: [string, ReactNode][] = [
    [
      'List address',
      <OriginalLink key="l" href={source.listUrl}>
        {source.listUrl}
      </OriginalLink>,
    ],
    [
      'Site',
      source.siteUrl ? (
        <OriginalLink key="s" href={source.siteUrl}>
          {source.siteUrl}
        </OriginalLink>
      ) : (
        'Not given'
      ),
    ],
    ['State', placeOf(source)],
    ['Kind', KIND_LABEL[source.kind]],
    ['Fetched every', `${formatNumber(n(source.fetchIntervalMin))} minutes${source.isActive ? '' : ' (when on)'}`],
    ['Last run', when(source.lastRunAt)],
    ['Last success', when(source.lastSuccessAt)],
    ['Last count', notices(n(source.lastItemCount))],
    ['Failures in a row', formatNumber(n(source.consecutiveFailures))],
    ['Empty runs in a row', formatNumber(n(source.consecutiveEmptyRuns))],
    ['Last error', source.lastError ?? 'None'],
    [
      'Notices',
      <span key="n">
        {notices(stored)} stored, {formatNumber(waiting)} waiting for review
        {waiting > 0 && (
          <>
            {' · '}
            <Link to={`/admin/news?sourceId=${source.id}`}>Review them</Link>
          </>
        )}
      </span>,
    ],
  ]

  return (
    <>
      <p>
        <Link to={SOURCES_HREF}>← News sources</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{source.name}</h1>
      <p className="adm-actions" style={{ marginTop: 8 }}>
        <HealthBadge status={source.status} />
        <OnOffBadge on={source.isActive} />
      </p>
      {saved === 'created' && !save && <Flash>Source added. Test it to see what it would find, then switch it on.</Flash>}
      {save?.ok && <Flash>Changes saved.</Flash>}

      <div style={{ marginTop: 16 }}>
        <Facts rows={facts} />
      </div>

      <h2>Try it</h2>
      {!source.canFetch && (
        <p className="hint">This kind of source cannot be read yet, so it cannot be tested or fetched.</p>
      )}
      <TestSource source={source} />
      <FetchNow source={source} topRunId={runs[0]?.id ?? null} />

      <h2>Recent runs</h2>
      <RunsTable runs={runs} />

      <h2>Settings</h2>
      <SourceForm source={source} states={states} failure={save && !save.ok ? save.failure : undefined} submitLabel="Save" />

      <h2>Delete</h2>
      <p className="hint">Only a source with no stored notices can be deleted. Otherwise switch it off.</p>
      <p>
        <Link className="btn btn-secondary" to={`${SOURCES_HREF}/${source.id}/delete`}>
          Delete source
        </Link>
      </p>
    </>
  )
}

/** Dry run: what a fetch would keep and what it would filter. Nothing is saved. */
function TestSource({ source }: { source: NewsSource }) {
  const fetcher = useFetcher<typeof clientAction>()
  const busy = fetcher.state !== 'idle'
  const data = !busy && fetcher.data?.intent === 'test' ? fetcher.data : undefined
  const result = data?.ok ? data.result : undefined
  const failed = data && !data.ok ? data.failure : undefined

  return (
    <>
      <fetcher.Form method="post" action={`${SOURCES_HREF}/${source.id}`} className="adm-actions">
        <input type="hidden" name="intent" value="test" />
        <button className="btn btn-secondary" type="submit" disabled={busy || !source.canFetch}>
          {busy ? 'Testing… (can take 20 seconds)' : 'Test'}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          Reads the site now as a real fetch would. Nothing is saved.
        </span>
      </fetcher.Form>
      {failed && (
        <p className="callout" role="status">
          The test could not run: {failed.formError}
        </p>
      )}
      {result && <TestReport result={result} />}
    </>
  )
}

function TestReport({ result }: { result: TestResult }) {
  const kept = result.items.filter((i) => i.relevant)
  const filtered = result.items.filter((i) => !i.relevant)
  const http = result.httpStatus === null ? '' : ` (HTTP ${n(result.httpStatus)})`
  return (
    <div style={{ marginTop: 16 }} role="status">
      <p className="callout">
        Test only: nothing was saved.{' '}
        {result.ok
          ? `Read ${notices(n(result.itemsFound))}${http}, ${formatNumber(n(result.itemsNew))} not stored yet.`
          : `The site could not be read${http}: ${result.error ?? 'no reason given'}.`}{' '}
        Address requested: {result.requestedUrl}
      </p>
      {result.ok && result.items.length === 0 && <p>No notices were found on the page.</p>}
      {result.items.length > 0 && n(result.itemsFound) > result.items.length && (
        <p className="hint">Showing the first {formatNumber(result.items.length)}, newest first as the site lists them.</p>
      )}
      {kept.length > 0 && <TestTable title={`Would go to review (${formatNumber(kept.length)})`} items={kept} />}
      {filtered.length > 0 && (
        <TestTable title={`Would be filtered (${formatNumber(filtered.length)})`} items={filtered} />
      )}
    </div>
  )
}

function testDate(item: TestItem): string {
  if (!item.sourcePublishedAt) return 'No date'
  const from = item.dateBasis === 'PDF' ? 'notice PDF' : item.dateBasis === 'SOURCE' ? 'official site' : 'first seen'
  return `${formatDate(item.sourcePublishedAt)} · ${from}`
}

function TestTable({ title, items }: { title: string; items: TestItem[] }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Notice</th>
              <th scope="col">Date</th>
              <th scope="col" className="hide-sm">
                Category
              </th>
              <th scope="col">Score</th>
              <th scope="col" className="hide-sm">
                Rules
              </th>
              <th scope="col" className="hide-sm">
                Stored?
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.url}>
                <td>
                  <OriginalLink href={item.url}>{item.title}</OriginalLink>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{testDate(item)}</td>
                <td className="hide-sm">{isCategory(item.category) ? CATEGORY_LABEL[item.category] : item.category}</td>
                <td>{n(item.score)}</td>
                <td className="hide-sm">{item.reasons.length > 0 ? item.reasons.join(', ') : '–'}</td>
                <td className="hide-sm">{item.isNew ? 'New' : 'Already stored'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

type Watch = { queued: RunQueued; run?: SourceRun; timedOut?: boolean }

/**
 * Queues a fetch, then watches Recent runs from the page (every 3 s for up to 60 s) until a new
 * run appears. The watching stops when the editor leaves the page.
 */
function FetchNow({ source, topRunId }: { source: NewsSource; topRunId: string | null }) {
  const fetcher = useFetcher<typeof clientAction>()
  const { revalidate } = useRevalidator()
  const data = fetcher.state === 'idle' && fetcher.data?.intent === 'run' ? fetcher.data : undefined
  const queued = data?.ok ? data : undefined
  const failed = data && !data.ok ? data.failure : undefined
  const [watch, setWatch] = useState<Watch | null>(null)

  useEffect(() => {
    if (!queued) return
    // `done` stops the watch (found, timed out or left the page); `asking` skips a tick while a
    // slow request is still out.
    const flags = { done: false, asking: false }
    const started = Date.now()
    const tick = async () => {
      if (flags.done || flags.asking) return
      flags.asking = true
      const result = await safeCall(
        adminApi.GET('/admin/news/sources/{id}/runs', { params: { path: { id: source.id }, query: { limit: 5 } } }),
      )
      flags.asking = false
      if (flags.done) return
      const top = (result as { data?: SourceRuns }).data?.items[0]
      if (top && top.id !== queued.previousTopRunId) {
        flags.done = true
        setWatch({ queued, run: top })
      } else if (Date.now() - started >= POLL_FOR_MS) {
        flags.done = true
        setWatch({ queued, timedOut: true })
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      flags.done = true
      clearInterval(timer)
    }
  }, [queued, source.id])

  // Once the run is in, reload the page data so health, facts and Recent runs show it. Once per run.
  const reloadedFor = useRef<Watch | null>(null)
  useEffect(() => {
    if (!watch?.run || reloadedFor.current === watch) return
    reloadedFor.current = watch
    void revalidate()
  }, [watch, revalidate])

  const current = watch && queued && watch.queued === queued ? watch : null
  const fetching = fetcher.state !== 'idle' || (queued !== undefined && current === null)
  const run = current?.run

  return (
    <>
      <fetcher.Form method="post" action={`${SOURCES_HREF}/${source.id}`} className="adm-actions" style={{ marginTop: 12 }}>
        <input type="hidden" name="intent" value="run" />
        <input type="hidden" name="previousTopRunId" value={topRunId ?? ''} />
        <button className="btn btn-secondary" type="submit" disabled={fetching || !source.canFetch}>
          {fetching ? 'Fetching…' : 'Fetch now'}
        </button>
        <span className="hint" style={{ margin: 0 }} role="status">
          {fetching
            ? 'Waiting for the background worker to read the official site. This can take up to a minute.'
            : 'Fetches the official site now and stores new notices, even if the source is off.'}
        </span>
      </fetcher.Form>
      {failed && (
        <p className="callout" role="status">
          The fetch could not be started: {failed.formError}
        </p>
      )}
      {current?.timedOut && (
        <p className="callout" role="status">
          Still waiting. The fetch runs in the background worker; Recent runs will show it when it finishes.
        </p>
      )}
      {run && (
        <p className="callout" role="status">
          {run.outcome === 'OK'
            ? `Fetch finished: found ${notices(n(run.itemsFound))}, ${formatNumber(n(run.itemsNew))} new.`
            : run.outcome === 'NOT_MODIFIED'
              ? 'Fetch finished: the page has not changed since the last fetch.'
              : `The fetch did not work (${OUTCOME_LABEL[run.outcome].toLowerCase()}): ${run.error ?? 'no reason given'}.`}
        </p>
      )}
    </>
  )
}

function RunsTable({ runs }: { runs: SourceRun[] }) {
  if (runs.length === 0) return <p>No runs yet.</p>
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" className="hide-sm">
              Duration
            </th>
            <th scope="col">Status</th>
            <th scope="col">Found</th>
            <th scope="col">New</th>
            <th scope="col" className="hide-sm">
              Error
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.startedAt)}</td>
              <td className="hide-sm">{formatDuration(n(r.durationMs))}</td>
              <td>
                {OUTCOME_LABEL[r.outcome]}
                {r.httpStatus !== null && <span className="hint" style={{ display: 'block', margin: 0 }}>HTTP {n(r.httpStatus)}</span>}
              </td>
              <td>{formatNumber(n(r.itemsFound))}</td>
              <td>{formatNumber(n(r.itemsNew))}</td>
              <td className="hide-sm">{r.error ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
