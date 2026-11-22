import { useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { HealthBadge, OnOffBadge } from '../../components/admin/news/components'
import { CATEGORY_LABEL, n, shorten } from '../../components/admin/news/data'
import { attentionRank, KIND_LABEL, placeOf, SOURCES_HREF } from '../../components/admin/news/sources'
import type { NewsStats, RelevanceResult, RescoreResult, SourceList } from '../../components/admin/news/types'
import { Flash, PageHead } from '../../components/admin/staff/common'
import { formatDate, formatNumber } from '../../components/shared/format'
import type { Route } from './+types/news-sources'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'News sources | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const [list, stats] = await Promise.all([
    loadOrThrow<SourceList>(adminApi.GET('/admin/news/sources')),
    loadOrThrow<NewsStats>(adminApi.GET('/admin/news/stats')),
  ])
  // Sources needing attention first; otherwise the API's order (switched-on first).
  const sources = list.items
    .map((s, i) => ({ s, i }))
    .sort((a, b) => attentionRank(a.s) - attentionRank(b.s) || a.i - b.i)
    .map(({ s }) => s)
  return { sources, totals: stats.sources, saved: new URL(request.url).searchParams.get('saved') }
}

type CheckDone = { intent: 'check'; ok: true; title: string; result: RelevanceResult }
type RescoreDone = { intent: 'rescore'; ok: true; result: RescoreResult }
type Failed = { intent: 'check' | 'rescore'; ok: false; failure: ApiFailure }

/** The relevance tools: check one title, and re-check waiting notices (dry run first, then apply). */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<CheckDone | RescoreDone | Failed> {
  const form = await request.formData()
  const intent = form.get('intent')
  const fail = (i: 'check' | 'rescore', formError: string, fieldErrors: Record<string, string> = {}): Failed => ({
    intent: i,
    ok: false,
    failure: { status: 0, formError, fieldErrors },
  })

  if (intent === 'check') {
    const title = String(form.get('title') ?? '').trim()
    if (!title) return fail('check', 'Type a notice title.', { title: 'Type a notice title.' })
    const result = await safeCall(adminApi.POST('/admin/news/relevance/test', { body: { title } }))
    const data = (result as { data?: RelevanceResult }).data
    if (result.response.ok && data) return { intent: 'check', ok: true, title, result: data }
    return { intent: 'check', ok: false, failure: handleApiError(result) }
  }
  if (intent === 'rescore-preview' || intent === 'rescore') {
    const body = intent === 'rescore-preview' ? { dryRun: true } : {}
    const result = await safeCall(adminApi.POST('/admin/news/rescore', { body }))
    const data = (result as { data?: RescoreResult }).data
    if (result.response.ok && data) return { intent: 'rescore', ok: true, result: data }
    return { intent: 'rescore', ok: false, failure: handleApiError(result) }
  }
  return fail('check', 'Unknown action.')
}

const SAVED: Record<string, string> = {
  created: 'Source added.',
  deleted: 'Source deleted.',
}

export default function NewsSources({ loaderData }: Route.ComponentProps) {
  const { sources, totals, saved } = loaderData
  const totalRows: [string, number][] = [
    ['Switched on', n(totals.active)],
    ['Off', n(totals.off)],
    ['OK', n(totals.ok)],
    ['Having trouble', n(totals.degraded)],
    ['Not working', n(totals.broken)],
  ]

  return (
    <>
      <p>
        <Link to="/admin/news">← News review</Link>
      </p>
      <PageHead title="News sources" action={{ to: `${SOURCES_HREF}/new`, label: 'New source' }} />
      <p className="hint" style={{ marginTop: 8 }}>
        The official sites watched for counselling notices. Sources that are switched on but having trouble or not
        working are listed first.
      </p>
      {saved && SAVED[saved] && <Flash>{SAVED[saved]}</Flash>}

      <dl className="adm-actions" style={{ marginTop: 16, gap: 24 }} aria-label="Source totals">
        {totalRows.map(([label, value]) => (
          <div key={label}>
            <dt className="hint" style={{ margin: 0 }}>
              {label}
            </dt>
            <dd style={{ margin: 0, fontWeight: 700, fontSize: '1.25rem' }}>{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">Health counts switched-on sources only.</p>

      {sources.length === 0 ? (
        <p style={{ marginTop: 24 }}>No sources yet. Add the first one.</p>
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">State</th>
                <th scope="col" className="hide-sm">
                  Kind
                </th>
                <th scope="col">On/off</th>
                <th scope="col">Health</th>
                <th scope="col" className="hide-sm">
                  Last success
                </th>
                <th scope="col" className="hide-sm">
                  Last count
                </th>
                <th scope="col" className="hide-sm">
                  Last error
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`${SOURCES_HREF}/${s.id}`}>{s.name}</Link>
                    {!s.canFetch && (
                      <span className="hint" style={{ display: 'block', margin: 0 }}>
                        Cannot be read yet
                      </span>
                    )}
                  </td>
                  <td>{placeOf(s)}</td>
                  <td className="hide-sm">{KIND_LABEL[s.kind]}</td>
                  <td>
                    <OnOffBadge on={s.isActive} />
                  </td>
                  <td>
                    <HealthBadge status={s.status} />
                  </td>
                  <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>
                    {s.lastSuccessAt ? formatDate(s.lastSuccessAt) : 'Never'}
                  </td>
                  <td className="hide-sm">{formatNumber(n(s.lastItemCount))}</td>
                  <td className="hide-sm" title={s.lastError ?? undefined}>
                    {s.lastError ? shorten(s.lastError, 80) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Relevance rules</h2>
      <p className="hint">
        The rules decide whether a new notice goes to the review queue or the Filtered tab. Nothing is published
        without a staff member.
      </p>
      <CheckTitle />
      <Rescore />
    </>
  )
}

/** Type a notice title, see its score and the rules that fired. Stores nothing. */
function CheckTitle() {
  const fetcher = useFetcher<typeof clientAction>()
  const busy = fetcher.state !== 'idle'
  const data = !busy && fetcher.data?.intent === 'check' ? fetcher.data : undefined
  const done = data?.ok ? data : undefined
  const failed = data && !data.ok ? data.failure : undefined
  const titleError = failed?.fieldErrors.title

  return (
    <>
      <h3>Check a title</h3>
      <fetcher.Form method="post" action={SOURCES_HREF} className="adm-form">
        <input type="hidden" name="intent" value="check" />
        {failed && !titleError && <FormError message={failed.formError} />}
        <div className={titleError ? 'field err' : 'field'}>
          <label htmlFor="check-title">Notice title</label>
          <input
            className="input"
            id="check-title"
            name="title"
            type="text"
            required
            placeholder="e.g. Special stray round counselling for MBBS/BDS 2026"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'check-title-err' : undefined}
          />
          {titleError && (
            <p className="err-msg" id="check-title-err">
              {titleError}
            </p>
          )}
        </div>
        <div className="adm-actions">
          <button className="btn btn-secondary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Check'}
          </button>
        </div>
      </fetcher.Form>
      {done && (
        <div className="callout" role="status">
          <p style={{ marginTop: 0 }}>
            <strong>{done.result.relevant ? 'Would go to the review queue.' : 'Would be filtered.'}</strong>
          </p>
          <p>
            “{done.title}”: score {n(done.result.score)} (the line is {n(done.result.threshold)}), category{' '}
            {CATEGORY_LABEL[done.result.category]}.
          </p>
          <p>
            Rules that fired:{' '}
            {done.result.reasons.length > 0 ? done.result.reasons.join(', ') : 'none'}. A “+” rule added to the
            score, a “−” rule took away; “(soft)” means the title names MBBS or NEET UG, so the penalty was reduced.
          </p>
        </div>
      )}
    </>
  )
}

const notices = (count: number) => `${formatNumber(count)} ${count === 1 ? 'notice' : 'notices'}`

function moves(r: RescoreResult): string {
  return `${formatNumber(n(r.toPending))} to the review queue, ${formatNumber(n(r.toFiltered))} to Filtered, ${formatNumber(n(r.repeatsFlagged))} newly marked as repeats`
}

/** Re-applies the rules to waiting and filtered notices: a dry run first, then "Apply". */
function Rescore() {
  const fetcher = useFetcher<typeof clientAction>()
  const busy = fetcher.state !== 'idle'
  // The last answer stays shown while the next request runs, so "Apply" shows "Applying…" in place.
  const data = fetcher.data?.intent === 'rescore' ? fetcher.data : undefined
  // The preview the editor cancelled; hidden until the next check.
  const [cancelled, setCancelled] = useState<typeof data>(undefined)
  const shown = data && data !== cancelled ? data : undefined
  const preview = shown?.ok && shown.result.dryRun ? shown.result : undefined
  const applied = shown?.ok && !shown.result.dryRun ? shown.result : undefined
  const failed = shown && !shown.ok ? shown.failure : undefined

  const send = (intent: 'rescore-preview' | 'rescore') => {
    setCancelled(undefined)
    fetcher.submit({ intent }, { method: 'post', action: SOURCES_HREF })
  }

  return (
    <>
      <h3>Re-check waiting notices</h3>
      <p className="hint">
        Run this after the rules or the relevance line change. It re-scores notices that wait for review or were
        filtered and that no one has handled yet. Notices staff have reviewed, published or rejected are never
        touched.
      </p>
      {failed && <FormError message={failed.formError} />}
      {preview ? (
        <div className="callout" role="status">
          <p style={{ marginTop: 0 }}>
            Looked at {notices(n(preview.examined))}. This would change {notices(n(preview.changed))}:{' '}
            {moves(preview)}. Nothing has been changed yet.
          </p>
          <div className="adm-actions">
            <button className="btn btn-secondary" type="button" onClick={() => send('rescore')} disabled={busy}>
              {busy ? 'Applying…' : 'Apply'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setCancelled(data)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-actions">
          <button className="btn btn-secondary" type="button" onClick={() => send('rescore-preview')} disabled={busy}>
            {busy ? 'Checking…' : 'Re-check waiting notices'}
          </button>
        </div>
      )}
      {applied && (
        <Flash>
          Changed {notices(n(applied.changed))}: {moves(applied)}.
        </Flash>
      )}
    </>
  )
}
