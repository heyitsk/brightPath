import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError, TextField } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { StaffUser } from '../../components/admin/sections'
import { requireAdmin } from '../../components/admin/staff/access'
import { MIN_PASSWORD, PASSWORD_HINT } from '../../components/admin/staff/common'
import type { Route } from './+types/users-reset'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Reset password | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadUser(id: string | undefined) {
  await requireAdmin()
  if (!id) throw new Response('Not found.', { status: 404 })
  const data = await loadOrThrow<{ user: StaffUser }>(adminApi.GET('/admin/users/{id}', { params: { path: { id } } }))
  return data.user
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { user: await loadUser(params.id) }
}

export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const user = await loadUser(params.id)
  const password = String((await request.formData()).get('password') ?? '')
  if (password.length < MIN_PASSWORD) {
    return {
      status: 0,
      formError: 'Please fix the highlighted fields.',
      fieldErrors: { password: `Use at least ${MIN_PASSWORD} characters.` },
    }
  }
  const result = await safeCall(
    adminApi.POST('/admin/users/{id}/reset-password', { params: { path: { id: user.id } }, body: { password } }),
  )
  if (result.response.ok) throw redirect('/admin/users?saved=reset')
  return handleApiError(result)
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const { user } = loaderData
  const busy = useNavigation().state !== 'idle'
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Reset password</h1>
      <p>
        <strong>{user.name}</strong> ({user.email})
      </p>
      <p>All their sessions end and any lockout is cleared.</p>
      <Form method="post" noValidate>
        <FormError message={actionData?.formError} />
        <TextField
          name="password"
          label="New temporary password"
          type="password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={actionData?.fieldErrors.password}
        />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set temporary password'}
          </button>
          <Link className="btn btn-light" to={`/admin/users/${user.id}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
