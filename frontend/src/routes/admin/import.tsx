import { useState, type ReactNode } from 'react'
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { SectionError } from '../../components/admin/crud/SectionError'
import { ImportStatusBadge, RowTable, Totals } from '../../components/admin/imports/components'
import {
  KIND_LABEL,
  n,
  PAGE,
  parseShow,
  RESULT_LABEL,
  SHOWS,
  type Show,
  when,
  whoLabel,
} from '../../components/admin/imports/data'
import type { Committed, Detail, Preview, PreviewItem, SkippedRow } from '../../components/admin/imports/types'
import { Facts, Messages } from '../../components/admin/neet/common'
import { Flash } from '../../components/admin/staff/common'
import { formatNumber } from '../../components/shared/format'
import type { Route } from './+types/import'
import type { clientLoader as layoutLoader } from './layout'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Bulk upload | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const GONE = 'This upload was discarded or does not exist.'
/** The API repeats the ignored headings as a notice; they get their own warning here. */
const IGNORED_NOTICE = 'These columns were not recognised'

async function loadDetail(
  id: string,
  query: { action?: PreviewItem['action']; warnings?: boolean; limit: number; offset: number },
) {
  const result = await safeCall(adminApi.GET('/admin/imports/{id}', { params: { path: { id }, query } }))
  const data = (result as { data?: Detail }).data
  if (result.response.ok && data) return data
  if (result.response.status === 404) throw new Response(GONE, { status: 404 })
  const failure = handleApiError(result)
  throw new Response(failure.formError, { status: failure.status || 503 })
}

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const sp = new URL(request.url).searchParams
  const show = parseShow(sp.get('show'))
  const page = Math.max(0, Math.floor(Number(sp.get('page')) || 0))
  const action = SHOWS.find((s) => s.key === show)?.action
  const warnings = show === 'warnings' ? true : undefined

  const detail = await loadDetail(params.id, { action, warnings, limit: PAGE, offset: page * PAGE })
  const preview = detail.preview
  return {
    ...detail,
    show,
    page,
    rows: preview?.items ?? [],
    total: n(preview?.itemsTotal),
    // Rows in the whole file with a warning, whatever the tab.
    warnings: preview ? n(preview.warningsCount) : null,
  }
}

type Outcome =
  | { kind: 'saved'; result: Committed['result'] }
  | { kind: 'blocked'; message: string; rows: string[] }
  | { kind: 'conflict' | 'error'; message: string }

export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<Outcome> {
  const form = await request.formData()
  const intent = form.get('intent')
  const { id } = params

  if (intent === 'discard') {
    const result = await safeCall(adminApi.DELETE('/admin/imports/{id}', { params: { path: { id } } }))
    // 404: already gone, which is what was asked for.
    if (result.response.ok || result.response.status === 404) throw redirect('/admin/imports?discarded=1')
    const failure = handleApiError(result)
    return { kind: failure.status === 409 ? 'conflict' : 'error', message: failure.formError }
  }

  const skipBadRows = intent === 'save-skip'
  const result = await safeCall(
    adminApi.POST('/admin/imports/{id}/commit', { params: { path: { id } }, body: skipBadRows ? { skipBadRows } : {} }),
  )
  const data = (result as { data?: Committed }).data
  if (result.response.ok && data) return { kind: 'saved', result: data.result }
  const failure = handleApiError(result)
  if (failure.status === 422) {
    const body = result.error as { error?: { fields?: { path: string; message: string }[] } } | undefined
    const rows = (body?.error?.fields ?? []).map((f) => `${f.path.replace(/^row /, 'Row ')}: ${f.message}`)
    return { kind: 'blocked', message: failure.formError, rows }
  }
  if (failure.status === 409) return { kind: 'conflict', message: failure.formError }
  if (failure.status === 404) return { kind: 'conflict', message: GONE }
  return { kind: 'error', message: failure.formError }
}

type Data = Route.ComponentProps['loaderData']

export default function ImportPage({ loaderData, actionData }: Route.ComponentProps) {
  const { batch, preview } = loaderData
  const meId = useRouteLoaderData<typeof layoutLoader>('routes/admin/layout')?.user.id
  const facts: [string, ReactNode][] = [
    ['Kind', KIND_LABEL[batch.kind]],
    ['Status', <ImportStatusBadge key="s" status={batch.status} />],
    ['Uploaded', `${when(batch.createdAt)} by ${whoLabel(batch, meId)}`],
  ]
  if (batch.committedAt) facts.push(['Saved', when(batch.committedAt)])
  if (preview) facts.push(['Sheet', `${preview.sheet}, ${formatNumber(n(preview.totalRows))} rows`])

  return (
    <>
      <p>
        <Link to="/admin/imports">← Bulk upload</Link>
      </p>
      <h1 style={{ marginTop: 0, overflowWrap: 'anywhere' }}>{batch.filename}</h1>
      {actionData?.kind === 'saved' && <Flash>Saved. {resultLine(actionData.result)}</Flash>}
      {actionData?.kind === 'conflict' && (
        <div className="callout" role="alert">
          <h3>Not saved</h3>
          <p>{actionData.message}</p>
        </div>
      )}
      {actionData?.kind === 'error' && (
        <p className="err-msg" role="alert" style={{ margin: '16px 0' }}>
          {actionData.message}
        </p>
      )}
      <Facts rows={facts} />
      {preview ? (
        <Waiting data={loaderData} preview={preview} outcome={actionData} />
      ) : batch.status === 'COMMITTED' ? (
        <Saved data={loaderData} />
      ) : (
        <p>This upload cannot be saved. Upload the file again to see a new preview.</p>
      )}
    </>
  )
}

function resultLine(result: Record<string, string | number> | null): string {
  if (!result) return ''
  return Object.entries(result)
    .map(([k, v]) => `${RESULT_LABEL[k] ?? k}: ${formatNumber(n(v))}`)
    .join(' · ')
}

/** A saved upload: read-only, with what was written and the rows that were left out. */
function Saved({ data }: { data: Data }) {
  const { batch, errors } = data
  const result = Object.entries(batch.result ?? {})
  return (
    <>
      {batch.counts && <Totals counts={batch.counts} warnings={null} />}
      {result.length > 0 && (
        <>
          <h2>What was saved</h2>
          <Facts rows={result.map(([k, v]) => [RESULT_LABEL[k] ?? k, formatNumber(n(v))])} />
        </>
      )}
      {errors.length > 0 && <SkippedRows rows={errors} />}
    </>
  )
}

function SkippedRows({ rows }: { rows: SkippedRow[] }) {
  return (
    <>
      <h2>Rows left out</h2>
      <p className="hint">These rows had problems and were not saved. Fix them in the file and upload just those rows again.</p>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">What</th>
              <th scope="col">Problem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${n(r.line)}-${r.label}`}>
                <td>{formatNumber(n(r.line))}</td>
                <td>{r.label}</td>
                <td>{r.message ?? 'Problem with this row.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** A waiting upload: totals, file-level messages, Save / Discard, then the rows. */
function Waiting({ data, preview, outcome }: { data: Data; preview: Preview; outcome?: Outcome }) {
  const { batch, show, page, rows, total, warnings } = data
  const notices = preview.notices.filter((m) => !m.startsWith(IGNORED_NOTICE))
  return (
    <>
      <Totals counts={preview.counts} warnings={warnings} />
      <Messages title="Please note" items={notices} />
      {preview.ignoredColumns.length > 0 && (
        <div className="callout" role="status">
          <h3>Warning: unrecognised column headings</h3>
          <p>
            These headings match no known column, so their values were ignored. This is usually a typo: check the
            spelling against the template.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {preview.ignoredColumns.map((c) => (
              <li key={c}>“{c}”</li>
            ))}
          </ul>
        </div>
      )}
      <Actions id={batch.id} preview={preview} outcome={outcome} />

      <h2 style={{ marginTop: 32 }}>Rows</h2>
      <nav aria-label="Show rows" className="adm-actions adm-tabs" style={{ margin: '0 0 16px' }}>
        {SHOWS.map((s) => (
          <Link
            key={s.key}
            className="btn btn-secondary"
            to={s.key === 'all' ? '?' : `?show=${s.key}`}
            aria-current={s.key === show ? 'page' : undefined}
            preventScrollReset
          >
            {s.key === 'warnings' && warnings !== null ? `${s.label} (${formatNumber(warnings)})` : s.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? <p>{emptyText(show)}</p> : <RowTable rows={rows} />}
      <Pager show={show} page={page} shown={rows.length} total={total} />
    </>
  )
}

function emptyText(show: Show): string {
  if (show === 'errors') return 'No row has an error.'
  if (show === 'warnings') return 'No row has a warning.'
  if (show === 'changes') return 'No row changes anything that is already stored.'
  return 'The file has no rows.'
}

function Pager({ show, page, shown, total }: { show: Show; page: number; shown: number; total: number }) {
  if (total <= PAGE && page === 0) return null
  const href = (p: number) => {
    const q = new URLSearchParams()
    if (show !== 'all') q.set('show', show)
    if (p > 0) q.set('page', String(p))
    return `?${q.toString()}`
  }
  const from = page * PAGE
  return (
    <div className="adm-pager" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      {page > 0 && (
        <Link className="btn btn-secondary" to={href(page - 1)}>
          Previous
        </Link>
      )}
      <span>
        Rows {formatNumber(shown === 0 ? 0 : from + 1)}–{formatNumber(from + shown)} of {formatNumber(total)}
      </span>
      {from + shown < total && (
        <Link className="btn btn-secondary" to={href(page + 1)}>
          Next
        </Link>
      )}
    </div>
  )
}

function Actions({ id, preview, outcome }: { id: string; preview: Preview; outcome?: Outcome }) {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const sending = busy ? navigation.formData?.get('intent') : null
  // Which upload the "Are you sure?" step is for, so opening another upload starts without it.
  const [confirmFor, setConfirmFor] = useState<string | null>(null)
  const confirming = confirmFor === id

  const bad = n(preview.counts.ERROR)
  const blocked = outcome?.kind === 'blocked' && preview.hasErrors
  const nothing = !preview.canSave

  return (
    <section className="adm-card" style={{ maxWidth: 'none', margin: '16px 0' }}>
      {blocked && (
        <div role="alert" style={{ marginBottom: 16 }}>
          <p className="err-msg">{outcome.message}</p>
          {outcome.rows.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {outcome.rows.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {nothing && (
        <p className="hint" style={{ marginTop: 0 }}>
          {preview.hasErrors
            ? 'No row can be saved: fix the file and upload it again.'
            : 'Nothing to save: every row is already up to date.'}
        </p>
      )}
      {confirming ? (
        <Form method="post" preventScrollReset>
          <p style={{ marginTop: 0 }}>
            <strong>Discard this upload?</strong> The preview is thrown away. Nothing on the site changes.
          </p>
          <div className="adm-actions">
            <button className="btn btn-primary" type="submit" name="intent" value="discard" disabled={busy}>
              {sending === 'discard' ? 'Discarding…' : 'Yes, discard it'}
            </button>
            <button className="btn btn-light" type="button" onClick={() => setConfirmFor(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </Form>
      ) : (
        <Form method="post" className="adm-actions" preventScrollReset>
          {blocked ? (
            <button className="btn btn-primary" type="submit" name="intent" value="save-skip" disabled={busy || nothing}>
              {sending === 'save-skip'
                ? 'Saving…'
                : `Save the good rows and skip the ${formatNumber(bad)} bad ${bad === 1 ? 'one' : 'ones'}`}
            </button>
          ) : (
            <button className="btn btn-primary" type="submit" name="intent" value="save" disabled={busy || nothing}>
              {sending === 'save' ? 'Saving…' : 'Save'}
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={() => setConfirmFor(id)} disabled={busy}>
            Discard
          </button>
        </Form>
      )}
    </section>
  )
}
