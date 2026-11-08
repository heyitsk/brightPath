import { Link } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { showDate } from '../../components/admin/crud/util'
import type { StaffUser } from '../../components/admin/sections'
import { requireAdmin } from '../../components/admin/staff/access'
import { EmptyState, Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/users'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Staff | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const SAVED: Record<string, string> = {
  created: 'Staff member created.',
  updated: 'Staff member saved.',
  deactivated: 'Staff member deactivated. Their sessions have ended.',
  reactivated: 'Staff member reactivated.',
  reset: 'Temporary password set. They must change it at their next login.',
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const me = await requireAdmin()
  const data = await loadOrThrow<{ items: StaffUser[] }>(adminApi.GET('/admin/users'))
  return { me, items: data.items, saved: new URL(request.url).searchParams.get('saved') }
}

export default function Staff({ loaderData }: Route.ComponentProps) {
  const { me, items, saved } = loaderData
  return (
    <>
      <PageHead title="Staff" action={{ to: '/admin/users/new', label: 'New staff member' }} />
      {saved && SAVED[saved] && <Flash>{SAVED[saved]}</Flash>}
      {items.length === 0 ? (
        <EmptyState items="staff" />
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th className="hide-sm">Last login</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
                    {u.id === me.id && ' (you)'}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    <span className={u.isActive ? 'adm-badge on' : 'adm-badge off'}>
                      {u.isActive ? 'Active' : 'Deactivated'}
                    </span>
                    {u.mustChangePassword && <div className="hint">Must change password</div>}
                  </td>
                  <td className="hide-sm">{u.lastLoginAt ? showDate(u.lastLoginAt) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
