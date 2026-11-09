import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import { loadYear } from '../../components/admin/neet/data'
import type { Route } from './+types/neet-delete'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Delete NEET year | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadDraft(year: string | undefined) {
  const { examYear } = await loadYear(year)
  if (examYear.status !== 'DRAFT') {
    throw new Response('Only a draft year can be deleted. Unpublish it first.', { status: 409 })
  }
  return examYear
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { year: await loadDraft(params.year) }
}

export async function clientAction({ params }: Route.ClientActionArgs): Promise<ApiFailure> {
  const y = await loadDraft(params.year)
  const result = await safeCall(
    adminApi.DELETE('/admin/neet/years/{year}', { params: { path: { year: String(y.year) } } }),
  )
  if (result.response.ok) throw redirect('/admin/neet?saved=deleted')
  return handleApiError(result)
}

export default function NeetDelete({ loaderData, actionData }: Route.ComponentProps) {
  const { year } = loaderData
  const busy = useNavigation().state !== 'idle'
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Delete NEET {year.year}?</h1>
      <p>This draft year, with its cut-offs and score counts, will be removed. This cannot be undone.</p>
      <Form method="post">
        <FormError message={actionData?.formError} />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete year'}
          </button>
          <Link className="btn btn-light" to={`/admin/neet/${year.year}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
