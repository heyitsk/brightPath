import { RequireSection } from '../../components/admin/crud/RequireSection'
import { ResourceList } from '../../components/admin/crud/ResourceList'
import { getResource, loadOrThrow } from '../../components/admin/crud/runtime'
import type { Row } from '../../components/admin/crud/types'
import type { Route } from './+types/section-list'

export { SectionError as ErrorBoundary } from '../../components/admin/crud/SectionError'
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `${getResource(params.section).title} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const cfg = getResource(params.section)
  const query = Object.fromEntries(new URL(request.url).searchParams)
  const data = await loadOrThrow<{ items: Row[]; nextCursor?: string | null }>(cfg.api.list(query))
  return { items: data.items, nextCursor: data.nextCursor ?? null, query }
}

export default function SectionList({ params, loaderData }: Route.ComponentProps) {
  const { items, nextCursor, query } = loaderData
  const cfg = getResource(params.section)
  // The States list is open to every role in the API (for the news filters); the page is not.
  return (
    <RequireSection href={`/admin/${cfg.key}`}>
      <ResourceList cfg={cfg} items={items} nextCursor={nextCursor} saved={query.saved ?? null} query={query} />
    </RequireSection>
  )
}
