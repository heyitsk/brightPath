import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { FieldInput } from '../../components/admin/crud/fields'
import { buildBody, initialValue } from '../../components/admin/crud/form-data'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { ReqBody } from '../../components/admin/crud/types'
import { loadSourceOptions, YEAR_FIELDS } from '../../components/admin/neet/data'
import type { Route } from './+types/neet-new'

type Create = ReqBody<paths['/admin/neet/years']['post']>

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'New NEET year | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  return { sources: await loadSourceOptions() }
}

export async function clientAction({ request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const body = buildBody(YEAR_FIELDS, await request.formData()) as Create
  const result = await safeCall(adminApi.POST('/admin/neet/years', { body }))
  if (result.response.ok) throw redirect(`/admin/neet/${body.year}?saved=created`)
  return handleApiError(result)
}

export default function NeetNew({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle'
  return (
    <>
      <p>
        <Link to="/admin/neet">← NEET data</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>New year</h1>
      <p className="hint">
        Fields marked <strong>*</strong> are required. The year starts as a draft.
      </p>
      <Form method="post" className="adm-form">
        <FormError message={actionData?.formError} />
        {YEAR_FIELDS.map((f) => (
          <FieldInput
            key={f.name}
            f={f}
            value={initialValue(f)}
            error={actionData?.fieldErrors[f.name]}
            options={f.lookup ? loaderData.sources : undefined}
          />
        ))}
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create year'}
          </button>
          <Link className="btn btn-light" to="/admin/neet">
            Cancel
          </Link>
        </div>
      </Form>
    </>
  )
}
