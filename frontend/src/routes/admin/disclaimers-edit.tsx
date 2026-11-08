import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import type { paths } from '../../api/schema'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import { showDate } from '../../components/admin/crud/util'
import { requireAdmin } from '../../components/admin/staff/access'
import type { Route } from './+types/disclaimers-edit'

type Disclaimer =
  paths['/admin/disclaimers']['get']['responses'][200]['content']['application/json']['items'][number]

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Edit disclaimer | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadDisclaimer(key: string | undefined) {
  await requireAdmin()
  const data = await loadOrThrow<{ items: Disclaimer[] }>(adminApi.GET('/admin/disclaimers'))
  const item = data.items.find((d) => d.key === key)
  if (!item) throw new Response('There is no such disclaimer.', { status: 404 })
  return item
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { item: await loadDisclaimer(params.key) }
}

export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const item = await loadDisclaimer(params.key)
  const text = String((await request.formData()).get('text') ?? '').trim()
  if (text.length < 10 || text.length > 2000) {
    const message = 'The text must be between 10 and 2000 characters.'
    return { status: 0, formError: message, fieldErrors: { text: message } }
  }
  const result = await safeCall(
    adminApi.PUT('/admin/disclaimers/{key}', { params: { path: { key: item.key } }, body: { text } }),
  )
  if (result.response.ok) {
    const version = (result as { data?: { item?: { version?: number | string } } }).data?.item?.version
    throw redirect(`/admin/disclaimers?saved=${encodeURIComponent(item.key)}&v=${version ?? ''}`)
  }
  const failure = handleApiError(result)
  if (failure.status === 409) failure.formError = 'That text is the same as the live version, so nothing was published.'
  return failure
}

export default function EditDisclaimer({ loaderData, actionData }: Route.ComponentProps) {
  const { item } = loaderData
  const busy = useNavigation().state !== 'idle'
  const error = actionData?.fieldErrors.text
  return (
    <>
      <p>
        <Link to="/admin/disclaimers">← Disclaimers</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{item.key}</h1>
      <p>{item.description}</p>
      <p className="callout" role="note">
        <strong>This text is shown on the public website.</strong> Saving publishes it immediately as a new version.
        Earlier versions are kept, but visitors see only the newest.
      </p>

      <p className="hint">
        Live now: {Number(item.version) === 0 ? 'built-in text' : `version ${item.version}`}. The box below starts with
        that text; edit it and publish.
      </p>

      <Form method="post" className="adm-form adm-wide" noValidate>
        <FormError message={error ? undefined : actionData?.formError} />
        <div className={error ? 'field err' : 'field'}>
          <label htmlFor="text">Text</label>
          <textarea
            className="input"
            id="text"
            name="text"
            rows={8}
            defaultValue={item.text}
            maxLength={2000}
            aria-invalid={error ? true : undefined}
          />
          <p className="hint">10 to 2000 characters.</p>
          {error && <p className="err-msg">{error}</p>}
        </div>
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish new version'}
          </button>
          <Link className="btn btn-light" to="/admin/disclaimers">
            Cancel
          </Link>
        </div>
      </Form>

      {item.history.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Earlier versions</h2>
          <ul>
            {item.history.map((h) => (
              <li key={String(h.version)} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                <strong>Version {String(h.version)}</strong> ({showDate(h.createdAt)}): {h.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
