import { Link, redirect } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { SectionError } from '../../components/admin/crud/SectionError'
import { loadStateChoices } from '../../components/admin/news/data'
import { SourceForm, type SourceFormFailure } from '../../components/admin/news/SourceForm'
import { createBody, readSourceForm, SOURCES_HREF, withConfigErrors } from '../../components/admin/news/sources'
import type { NewsSource } from '../../components/admin/news/types'
import type { Route } from './+types/news-source-new'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'New news source | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  return { states: await loadStateChoices() }
}

/** Creates the source (switched off unless ticked) and opens it, where it can be tested. */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<SourceFormFailure> {
  const { values, fieldErrors } = readSourceForm(await request.formData())
  const body = createBody(values)
  if (Object.keys(fieldErrors).length > 0 || !body) {
    return { formError: 'Please fix the highlighted fields.', fieldErrors }
  }
  const result = await safeCall(adminApi.POST('/admin/news/sources', { body }))
  const data = (result as { data?: { source: NewsSource } }).data
  if (result.response.ok && data) throw redirect(`${SOURCES_HREF}/${data.source.id}?saved=created`)
  const failure = handleApiError(result)
  return { formError: failure.formError, fieldErrors: withConfigErrors(failure.fieldErrors) }
}

export default function NewsSourceNew({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <p>
        <Link to={SOURCES_HREF}>← News sources</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>New news source</h1>
      <p className="hint">
        A new source starts switched off. After adding it, use Test to see what it would find, then switch it on.
      </p>
      <SourceForm states={loaderData.states} failure={actionData} submitLabel="Add source" />
    </>
  )
}
