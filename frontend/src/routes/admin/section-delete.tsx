import { DeleteConfirm } from '../../components/admin/crud/DeleteConfirm'
import { finish, getResource, loadRecord } from '../../components/admin/crud/runtime'
import type { Route } from './+types/section-delete'

export { SectionError as ErrorBoundary } from '../../components/admin/crud/SectionError'
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Delete ${getResource(params.section).singular} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

/** Only sections whose API has DELETE (sources, NMC notices) get a delete page. */
function deletable(section: string | undefined) {
  const cfg = getResource(section)
  const remove = cfg.api.remove
  if (!remove) throw new Response(`${cfg.title} cannot be deleted.`, { status: 404 })
  return { cfg, remove }
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { cfg } = deletable(params.section)
  return { row: await loadRecord(cfg, params.id) }
}

export async function clientAction({ params }: Route.ClientActionArgs) {
  const { cfg, remove } = deletable(params.section)
  if (!params.id) throw new Response('Not found.', { status: 404 })
  return finish(remove(params.id), cfg, 'deleted')
}

export default function SectionDelete({ params, loaderData, actionData }: Route.ComponentProps) {
  return <DeleteConfirm cfg={getResource(params.section)} row={loaderData.row} failure={actionData} />
}
