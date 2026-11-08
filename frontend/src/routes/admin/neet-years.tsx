import { Link } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { showDate } from '../../components/admin/crud/util'
import { SourceLine, StatusBadge } from '../../components/admin/neet/common'
import { num } from '../../components/admin/neet/data'
import type { YearList } from '../../components/admin/neet/types'
import { EmptyState, Flash, PageHead } from '../../components/admin/staff/common'
import type { Route } from './+types/neet-years'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'NEET data | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const data = await loadOrThrow<YearList>(adminApi.GET('/admin/neet/years'))
  return { items: data.items, saved: new URL(request.url).searchParams.get('saved') }
}

const SAVED: Record<string, string> = { created: 'Year created.', deleted: 'Year deleted.' }

export default function NeetYears({ loaderData }: Route.ComponentProps) {
  const { items, saved } = loaderData
  return (
    <>
      <PageHead title="NEET data" action={{ to: '/admin/neet/new', label: 'New year' }} />
      {saved && SAVED[saved] && <Flash>{SAVED[saved]}</Flash>}
      {items.length === 0 ? (
        <EmptyState items="years" />
      ) : (
        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Status</th>
                <th>Appeared</th>
                <th className="hide-sm">Qualified</th>
                <th className="hide-sm">Score counts from NTA</th>
                <th className="hide-sm">Source</th>
                <th className="hide-sm">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((y) => (
                <tr key={y.id}>
                  <td>
                    <Link to={`/admin/neet/${y.year}`}>{y.year}</Link>
                  </td>
                  <td>
                    <StatusBadge status={y.status} />
                  </td>
                  <td>{num(y.appeared)}</td>
                  <td className="hide-sm">{num(y.qualified)}</td>
                  <td className="hide-sm">{y.rankData ? 'Yes' : 'No'}</td>
                  <td className="hide-sm">
                    <SourceLine y={y} />
                  </td>
                  <td className="hide-sm">{showDate(y.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
