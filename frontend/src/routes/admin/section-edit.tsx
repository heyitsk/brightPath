import { ResourceForm } from '../../components/admin/crud/ResourceForm'
import { buildBody } from '../../components/admin/crud/form-data'
import { finish, getResource, loadLookups, loadRecord } from '../../components/admin/crud/runtime'
import type { Route } from './+types/section-edit'

export { SectionError as ErrorBoundary } from '../../components/admin/crud/SectionError'
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Edit ${getResource(params.section).singular} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const cfg = getResource(params.section)
  const [row, lookups] = await Promise.all([loadRecord(cfg, params.id), loadLookups(cfg)])
  return { row, lookups }
}

/** PATCH sends only the fields that changed. */
export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const cfg = getResource(params.section)
  const row = await loadRecord(cfg, params.id)
  const body = buildBody(cfg.fields, await request.formData(), row)
  if (Object.keys(body).length === 0) {
    return { status: 0, formError: 'Nothing was changed.', fieldErrors: {} }
  }
  return finish(cfg.api.update(row.id, body), cfg, 'updated')
}

export default function SectionEdit({ params, loaderData, actionData }: Route.ComponentProps) {
  return (
    <ResourceForm
      cfg={getResource(params.section)}
      row={loaderData.row}
      lookups={loaderData.lookups}
      failure={actionData}
    />
  )
}
