import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadCollege } from '../../components/admin/colleges/data'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { Route } from './+types/college-delete'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Delete college | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

const NOT_DRAFT = 'Only drafts can be deleted. A college that has been live is archived instead.'

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const college = await loadCollege(params.id)
  if (college.status !== 'DRAFT') throw new Response(NOT_DRAFT, { status: 404 })
  return { college }
}

export async function clientAction({ params }: Route.ClientActionArgs): Promise<ApiFailure> {
  const result = await safeCall(adminApi.DELETE('/admin/colleges/{id}', { params: { path: { id: params.id } } }))
  if (result.response.ok) throw redirect('/admin/colleges?saved=deleted')
  return handleApiError(result)
}

export default function CollegeDelete({ loaderData, actionData }: Route.ComponentProps) {
  const { college } = loaderData
  const busy = useNavigation().state !== 'idle'
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Delete college?</h1>
      <p>
        <strong>{college.name}</strong> ({college.city}) will be removed with its fees, source links and FAQs. This
        cannot be undone.
      </p>
      <Form method="post">
        <FormError message={actionData?.formError} />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete college'}
          </button>
          <Link className="btn btn-secondary" to={`/admin/colleges/${college.id}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
