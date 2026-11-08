import { useState } from 'react'
import { Form, Link } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import type { paths } from '../../api/schema'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { StaffUser } from '../../components/admin/sections'
import { requireAdmin } from '../../components/admin/staff/access'
import { EmptyState, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/audit-logs'

type Page = paths['/admin/audit-logs']['get']['responses'][200]['content']['application/json']
type Entry = Page['items'][number]
type Query = NonNullable<paths['/admin/audit-logs']['get']['parameters']['query']>

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Audit log | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

function queryFrom(params: URLSearchParams): Query {
  return {
    entityType: params.get('entityType') || undefined,
    action: params.get('action') || undefined,
    actorId: params.get('actorId') || undefined,
  }
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireAdmin()
  const filters = queryFrom(new URL(request.url).searchParams)
  const [page, staff] = await Promise.all([
    loadOrThrow<Page>(adminApi.GET('/admin/audit-logs', { params: { query: filters } })),
    loadOrThrow<{ items: StaffUser[] }>(adminApi.GET('/admin/users')),
  ])
  return { filters, items: page.items, nextCursor: page.nextCursor, staff: staff.items }
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AuditLog({ loaderData }: Route.ComponentProps) {
  const { filters, staff } = loaderData
  // Remount when the filters change so "Load more" rows never leak between searches.
  const key = JSON.stringify(filters)
  const filtered = Boolean(filters.entityType || filters.action || filters.actorId)
  return (
    <>
      <PageHead title="Audit log" />
      <p className="hint">Every change made by staff, newest first. This list is read-only.</p>
      <Form method="get" className="adm-filters">
        <div className="field">
          <label htmlFor="f-entityType">Entity type</label>
          <input className="input" id="f-entityType" name="entityType" defaultValue={filters.entityType ?? ''} placeholder="e.g. StaffUser" />
        </div>
        <div className="field">
          <label htmlFor="f-action">Action</label>
          <input className="input" id="f-action" name="action" defaultValue={filters.action ?? ''} placeholder="e.g. setting.update" />
        </div>
        <div className="field">
          <label htmlFor="f-actorId">Staff</label>
          <select className="select" id="f-actorId" name="actorId" defaultValue={filters.actorId ?? ''}>
            <option value="">Anyone</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
        {filtered && (
          <Link className="btn btn-light" to="/admin/audit-logs">
            Clear
          </Link>
        )}
      </Form>
      <AuditTable key={key} filters={filters} first={loaderData.items} firstCursor={loaderData.nextCursor} filtered={filtered} />
    </>
  )
}

function AuditTable(props: { filters: Query; first: Entry[]; firstCursor: string | null; filtered: boolean }) {
  const [items, setItems] = useState<Entry[]>(props.first)
  const [cursor, setCursor] = useState<string | null>(props.firstCursor)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadMore() {
    if (!cursor) return
    setBusy(true)
    setError(null)
    const result = await safeCall(
      adminApi.GET('/admin/audit-logs', { params: { query: { ...props.filters, cursor } } }),
    )
    const data = (result as { data?: Page }).data
    if (result.response.ok && data) {
      setItems((prev) => [...prev, ...data.items])
      setCursor(data.nextCursor)
    } else {
      try {
        setError(handleApiError(result).formError)
      } catch {
        setError('Your session has ended. Reload the page to log in again.')
      }
    }
    setBusy(false)
  }

  if (items.length === 0) {
    return props.filtered ? (
      <p style={{ marginTop: 24 }}>No rows match these filters.</p>
    ) : (
      <EmptyState items="audit entries" />
    )
  }
  return (
    <>
      <div className="tbl-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Staff</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{when(e.at)}</td>
                <td>{e.actorEmail ?? 'Unknown'}</td>
                <td>{e.action}</td>
                <td>
                  {e.entityType}
                  <div className="hint">{e.entityId}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="err-msg" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      {cursor && (
        <p style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" type="button" onClick={loadMore} disabled={busy}>
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </p>
      )}
    </>
  )
}
