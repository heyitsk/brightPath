import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { StaffUser } from '../../components/admin/sections'
import { requireAdmin } from '../../components/admin/staff/access'
import { RoleSelect } from '../../components/admin/staff/RoleSelect'
import { isRole } from '../../components/admin/staff/roles'
import type { Route } from './+types/users-edit'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Edit staff member | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadUser(id: string | undefined) {
  if (!id) throw new Response('Not found.', { status: 404 })
  const data = await loadOrThrow<{ user: StaffUser }>(adminApi.GET('/admin/users/{id}', { params: { path: { id } } }))
  return data.user
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const me = await requireAdmin()
  return { user: await loadUser(params.id), isSelf: me.id === params.id }
}

/** PATCH sends only what changed. Role is never sent for your own account (the API forbids it). */
export async function clientAction({ params, request }: Route.ClientActionArgs): Promise<ApiFailure> {
  const me = await requireAdmin()
  const user = await loadUser(params.id)
  const form = await request.formData()
  const body: { name?: string; role?: StaffUser['role'] } = {}
  const name = String(form.get('name') ?? '').trim()
  if (!name) return { status: 0, formError: 'Please fix the highlighted fields.', fieldErrors: { name: 'Enter a name.' } }
  if (name !== user.name) body.name = name
  const role = String(form.get('role') ?? '')
  if (me.id !== user.id && isRole(role) && role !== user.role) body.role = role
  if (Object.keys(body).length === 0) return { status: 0, formError: 'Nothing was changed.', fieldErrors: {} }
  const result = await safeCall(adminApi.PATCH('/admin/users/{id}', { params: { path: { id: user.id } }, body }))
  if (result.response.ok) throw redirect('/admin/users?saved=updated')
  return handleApiError(result)
}

export default function EditStaff({ loaderData, actionData }: Route.ComponentProps) {
  const { user, isSelf } = loaderData
  const busy = useNavigation().state !== 'idle'
  return (
    <>
      <p>
        <Link to="/admin/users">← Staff</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Edit {user.name}</h1>
      <Form method="post" className="adm-form" noValidate>
        <FormError message={actionData?.formError} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" value={user.email} readOnly />
          <p className="hint">The email cannot be changed.</p>
        </div>
        <div className={actionData?.fieldErrors.name ? 'field err' : 'field'}>
          <label htmlFor="name">Name</label>
          <input className="input" id="name" name="name" defaultValue={user.name} maxLength={120} />
          {actionData?.fieldErrors.name && <p className="err-msg">{actionData.fieldErrors.name}</p>}
        </div>
        {isSelf ? (
          <p className="hint">This is your own account. You cannot change your own role or deactivate yourself.</p>
        ) : (
          <>
            <RoleSelect value={user.role} error={actionData?.fieldErrors.role} />
            <p className="hint">Changing a role ends that person&apos;s sessions.</p>
          </>
        )}
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <Link className="btn btn-light" to="/admin/users">
            Cancel
          </Link>
        </div>
      </Form>
      <h2 style={{ marginTop: 32 }}>Account</h2>
      <p>
        Status: <strong>{user.isActive ? 'Active' : 'Deactivated'}</strong>
        {user.mustChangePassword && ' · must change password at next login'}
      </p>
      <div className="adm-actions">
        <Link className="btn btn-secondary" to={`/admin/users/${user.id}/reset-password`}>
          Reset password
        </Link>
        {!isSelf && (
          <Link className="btn btn-secondary" to={`/admin/users/${user.id}/status`}>
            {user.isActive ? 'Deactivate' : 'Reactivate'}
          </Link>
        )}
      </div>
    </>
  )
}
