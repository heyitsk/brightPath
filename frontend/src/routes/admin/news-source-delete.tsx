import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { n } from '../../components/admin/news/data'
import { SOURCES_HREF } from '../../components/admin/news/sources'
import type { NewsSource } from '../../components/admin/news/types'
import type { Route } from './+types/news-source-delete'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Delete news source | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const data = await loadOrThrow<{ source: NewsSource }>(
    adminApi.GET('/admin/news/sources/{id}', { params: { path: { id: params.id } } }),
  )
  return { source: data.source }
}

/** A source with stored notices is refused (409) with the API's own reason. */
export async function clientAction({ params }: Route.ClientActionArgs): Promise<ApiFailure> {
  const result = await safeCall(adminApi.DELETE('/admin/news/sources/{id}', { params: { path: { id: params.id } } }))
  if (result.response.ok) throw redirect(`${SOURCES_HREF}?saved=deleted`)
  return handleApiError(result)
}

export default function NewsSourceDelete({ loaderData, actionData }: Route.ComponentProps) {
  const { source } = loaderData
  const busy = useNavigation().state !== 'idle'
  const stored = n(source.itemCount)
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Delete news source?</h1>
      <p>
        <strong>{source.name}</strong> will be removed. This cannot be undone.
      </p>
      {stored > 0 && (
        <p className="hint">
          This source has stored notices, so it cannot be deleted. Switch it off on its page instead.
        </p>
      )}
      <Form method="post">
        <FormError message={actionData?.formError} />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete source'}
          </button>
          <Link className="btn btn-secondary" to={`${SOURCES_HREF}/${source.id}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
