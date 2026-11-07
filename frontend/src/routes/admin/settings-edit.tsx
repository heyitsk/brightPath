import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { requireAdmin } from '../../components/admin/staff/access'
import { kindOf, parseValue, showValue } from '../../components/admin/staff/setting-value'
import type { Route } from './+types/settings-edit'

type Setting = paths['/admin/settings']['get']['responses'][200]['content']['application/json']['items'][number]

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Edit setting | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadSetting(key: string | undefined) {
  await requireAdmin()
  const data = await loadOrThrow<{ items: Setting[] }>(adminApi.GET('/admin/settings'))
  const setting = data.items.find((s) => s.key === key)
  if (!setting) throw new Response('There is no such setting.', { status: 404 })
  return setting
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { setting: await loadSetting(params.key) }
}

export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const setting = await loadSetting(params.key)
  const kind = kindOf(setting.value, setting.default)
  const parsed = parseValue(kind, String((await request.formData()).get('value') ?? ''))
  if ('error' in parsed) return { status: 0, formError: parsed.error, fieldErrors: { value: parsed.error } }
  const result = await safeCall(
    adminApi.PUT('/admin/settings/{key}', { params: { path: { key: setting.key } }, body: { value: parsed.value } }),
  )
  if (result.response.ok) throw redirect('/admin/settings?saved=updated')
  return handleApiError(result)
}

export default function EditSetting({ loaderData, actionData }: Route.ComponentProps) {
  const { setting } = loaderData
  const busy = useNavigation().state !== 'idle'
  const kind = kindOf(setting.value, setting.default)
  const error = actionData?.fieldErrors.value
  const current = setting.value
  const common = { id: 'value', name: 'value', 'aria-invalid': error ? true : undefined }
  return (
    <>
      <p>
        <Link to="/admin/settings">← Settings</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{setting.key}</h1>
      <p>{setting.description}</p>
      {setting.isPublic && <p className="hint">This value is public: it is shown on the public site.</p>}
      <p className="hint">
        Default: {showValue(setting.default)}
        {setting.isDefault && ' (currently using the default)'}
      </p>
      <Form method="post" className="adm-form" noValidate>
        <FormError message={error ? undefined : actionData?.formError} />
        <div className={error ? 'field err' : 'field'}>
          <label htmlFor="value">Value</label>
          {kind === 'number' && (
            <input className="input" type="number" step="1" defaultValue={String(current ?? '')} {...common} />
          )}
          {kind === 'boolean' && (
            <select className="select" defaultValue={String(current === true)} {...common}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          )}
          {kind === 'list' && (
            <textarea
              className="input"
              rows={4}
              defaultValue={Array.isArray(current) ? current.join('\n') : ''}
              {...common}
            />
          )}
          {kind === 'text' && (
            <input className="input" type="text" defaultValue={typeof current === 'string' ? current : ''} {...common} />
          )}
          {kind === 'list' && <p className="hint">One per line.</p>}
          {kind === 'text' && <p className="hint">Leave empty to clear the value.</p>}
          {error && <p className="err-msg">{error}</p>}
        </div>
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save setting'}
          </button>
          <Link className="btn btn-light" to="/admin/settings">
            Cancel
          </Link>
        </div>
      </Form>
    </>
  )
}
