import { Form, Link, useNavigation, useSearchParams } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import { showDate } from '../../components/admin/crud/util'
import { Messages, StatusBadge, YearNav } from '../../components/admin/neet/common'
import { loadYear } from '../../components/admin/neet/data'
import type { ExamYear } from '../../components/admin/neet/types'
import type { Route } from './+types/neet-publish'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Publish NEET ${params.year} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { detail: await loadYear(params.year) }
}

type Done = { ok: true; verb: 'Published' | 'Unpublished'; year: ExamYear }

/** The button sends what it intends to do, so a stale page can never flip the year the wrong way. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure | Done> {
  const { examYear } = await loadYear(params.year)
  const path = { year: String(examYear.year) }
  const publish = (await request.formData()).get('intent') === 'publish'
  const result = await safeCall(
    publish
      ? adminApi.POST('/admin/neet/years/{year}/publish', { params: { path } })
      : adminApi.POST('/admin/neet/years/{year}/unpublish', { params: { path } }),
  )
  if ('data' in result && result.data) {
    return { ok: true, verb: publish ? 'Published' : 'Unpublished', year: result.data.examYear }
  }
  return handleApiError(result)
}

export default function NeetPublish({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams()
  const busy = useNavigation().state !== 'idle'
  const done = actionData && 'ok' in actionData ? actionData : null
  const failure = actionData && !('ok' in actionData) ? actionData : null
  const y = done?.year ?? loaderData.detail.examYear
  const isPublished = y.status === 'PUBLISHED'
  const confirming = params.get('confirm') === '1' && !done
  const verb = isPublished ? 'Unpublish' : 'Publish'

  return (
    <>
      <YearNav year={y.year} current="publish" />
      <p>
        <StatusBadge status={y.status} />
        {y.publishedAt ? ` Published ${showDate(y.publishedAt)}.` : ''}
      </p>

      {done && (
        <div className="callout" role="status">
          <h3>
            {done.verb} NEET {done.year.year}
          </h3>
          <p>Status is now {done.year.status === 'PUBLISHED' ? 'published' : 'draft'}.</p>
        </div>
      )}

      <Messages title="Still blocks publishing" items={y.publishProblems} tone="problem" />
      <Messages title="Warnings" items={y.warnings} />

      {confirming ? (
        <div className="adm-card">
          <h2 style={{ marginTop: 0 }}>
            {verb} NEET {y.year}?
          </h2>
          <Form method="post">
            <FormError message={failure?.formError} />
            <input type="hidden" name="intent" value={isPublished ? 'unpublish' : 'publish'} />
            <div className="adm-actions">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Working…' : `Yes, ${verb.toLowerCase()}`}
              </button>
              <Link className="btn btn-light" to={`/admin/neet/${y.year}/publish`}>
                Cancel
              </Link>
            </div>
          </Form>
        </div>
      ) : (
        <>
          <FormError message={failure?.formError} />
          <div className="adm-actions">
            <Link className="btn btn-primary" to={`/admin/neet/${y.year}/publish?confirm=1`}>
              {verb}…
            </Link>
          </div>
        </>
      )}
    </>
  )
}
