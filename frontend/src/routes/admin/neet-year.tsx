import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { FieldInput } from '../../components/admin/crud/fields'
import { buildBody, initialValue } from '../../components/admin/crud/form-data'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { ReqBody } from '../../components/admin/crud/types'
import { showDate } from '../../components/admin/crud/util'
import { Facts, Messages, SourceLine, StatusBadge, YearNav } from '../../components/admin/neet/common'
import { loadSourceOptions, loadYear, num, YEAR_FIELDS } from '../../components/admin/neet/data'
import { Flash } from '../../components/admin/staff/common'
import type { Route } from './+types/neet-year'

type Update = ReqBody<paths['/admin/neet/years/{year}']['patch']>

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = ({ params }) => [
  { title: `NEET ${params.year} | Admin` },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const [detail, sources] = await Promise.all([loadYear(params.year), loadSourceOptions()])
  return { detail, sources, saved: new URL(request.url).searchParams.get('saved') }
}

/** PATCH sends only the fields that changed. */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const { examYear } = await loadYear(params.year)
  const body = buildBody(YEAR_FIELDS, await request.formData(), examYear) as Update
  if (Object.keys(body).length === 0) return { status: 0, formError: 'Nothing was changed.', fieldErrors: {} }
  const result = await safeCall(
    adminApi.PATCH('/admin/neet/years/{year}', { params: { path: { year: String(examYear.year) } }, body }),
  )
  if (result.response.ok) throw redirect(`/admin/neet/${examYear.year}?saved=updated`)
  return handleApiError(result)
}

export default function NeetYear({ loaderData, actionData }: Route.ComponentProps) {
  const { detail, sources, saved } = loaderData
  const y = detail.examYear
  const busy = useNavigation().state !== 'idle'
  return (
    <>
      <YearNav year={y.year} current="figures" />
      {saved === 'updated' && <Flash>Saved.</Flash>}
      {saved === 'created' && <Flash>Year created. It is a draft until you publish it.</Flash>}

      <p>
        <StatusBadge status={y.status} />
      </p>
      <Facts
        rows={[
          ['Students who appeared', num(y.appeared)],
          ['Students who qualified', num(y.qualified)],
          ['Topper score', num(y.topperScore)],
          ['Score counts from NTA', y.rankData ? 'Yes' : 'No'],
          ['Result date', showDate(y.resultDate)],
          ['Rank method', y.basis ? y.basis.replace(/_/g, ' ').toLowerCase() : '-'],
          ['Method note', y.methodNote ?? '-'],
          ['Source and check', <SourceLine key="s" y={y} />],
        ]}
      />
      <Messages title="Still blocks publishing" items={y.publishProblems} tone="problem" />
      <Messages title="Warnings" items={y.warnings} />

      <h2>Edit official figures</h2>
      <Form method="post" className="adm-form">
        <FormError message={actionData?.formError} />
        {YEAR_FIELDS.map((f) => (
          <FieldInput
            key={f.name}
            f={f}
            value={initialValue(f, y)}
            error={actionData?.fieldErrors[f.name]}
            options={f.lookup ? sources : undefined}
            locked={f.fixedOnEdit}
          />
        ))}
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {y.status === 'DRAFT' && (
            <Link className="btn btn-light" to={`/admin/neet/${y.year}/delete`}>
              Delete year
            </Link>
          )}
        </div>
      </Form>
    </>
  )
}
