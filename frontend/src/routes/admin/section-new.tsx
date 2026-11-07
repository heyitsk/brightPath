import { ResourceForm } from '../../components/admin/crud/ResourceForm'
import { buildBody } from '../../components/admin/crud/form-data'
import { finish, getResource, loadLookups } from '../../components/admin/crud/runtime'
import type { Route } from './+types/section-new'

export { SectionError as ErrorBoundary } from '../../components/admin/crud/SectionError'
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `New ${getResource(params.section).singular} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { lookups: await loadLookups(getResource(params.section)) }
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const cfg = getResource(params.section)
  const body = buildBody(cfg.fields, await request.formData())
  return finish(cfg.api.create(body), cfg, 'created')
}

export default function SectionNew({ params, loaderData, actionData }: Route.ComponentProps) {
  return <ResourceForm cfg={getResource(params.section)} lookups={loaderData.lookups} failure={actionData} />
}
