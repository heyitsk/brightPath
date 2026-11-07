import { Link } from 'react-router'
import { adminApi } from '../../api/client.browser'
import type { paths } from '../../api/schema'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { requireAdmin } from '../../components/admin/staff/access'
import { EmptyState, Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/disclaimers'

type Disclaimer =
  paths['/admin/disclaimers']['get']['responses'][200]['content']['application/json']['items'][number]

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Disclaimers | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireAdmin()
  const data = await loadOrThrow<{ items: Disclaimer[] }>(adminApi.GET('/admin/disclaimers'))
  const q = new URL(request.url).searchParams
  return { items: data.items, saved: q.get('saved'), version: q.get('v') }
}

export default function Disclaimers({ loaderData }: Route.ComponentProps) {
  const { items, saved, version } = loaderData
  return (
    <>
      <PageHead title="Disclaimers" />
      {saved && (
        <Flash>
          Disclaimer {saved} published{version ? `: it is now version ${version}` : ''}. It is live on the public site.
        </Flash>
      )}
      {items.length === 0 ? (
        <EmptyState items="disclaimers" />
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Version</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.key}>
                  <td>
                    <Link to={`/admin/disclaimers/${encodeURIComponent(d.key)}`}>{d.key}</Link>
                    <div className="hint">{d.description}</div>
                  </td>
                  <td>{Number(d.version) === 0 ? 'Built-in' : String(d.version)}</td>
                  <td>{d.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
