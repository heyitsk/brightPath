import { Link } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { requireAdmin } from '../../components/admin/staff/access'
import { EmptyState, Flash, PageHead } from '../../components/admin/staff/common'
import { showValue } from '../../components/admin/staff/setting-value'
import type { paths } from '../../api/schema'
import type { Route } from './+types/settings'

type Setting = paths['/admin/settings']['get']['responses'][200]['content']['application/json']['items'][number]

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Settings | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireAdmin()
  const data = await loadOrThrow<{ items: Setting[] }>(adminApi.GET('/admin/settings'))
  return { items: data.items, saved: new URL(request.url).searchParams.get('saved') }
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { items, saved } = loaderData
  return (
    <>
      <PageHead title="Settings" />
      {saved === 'updated' && <Flash>Setting saved.</Flash>}
      {items.length === 0 ? (
        <EmptyState items="settings" />
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th className="hide-sm">Description</th>
                <th>Current value</th>
                <th className="hide-sm">Default</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.key}>
                  <td>
                    <Link to={`/admin/settings/${encodeURIComponent(s.key)}`}>{s.key}</Link>
                    {s.isPublic && (
                      <>
                        {' '}
                        <span className="adm-badge pub">Public</span>
                      </>
                    )}
                  </td>
                  <td className="hide-sm">{s.description}</td>
                  <td>
                    {showValue(s.value)}
                    {s.isDefault && <div className="hint">Using default</div>}
                  </td>
                  <td className="hide-sm">{showValue(s.default)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
