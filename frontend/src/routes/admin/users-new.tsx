import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError, TextField } from '../../components/admin/AdminFormError'
import { SectionError } from '../../components/admin/crud/SectionError'
import { requireAdmin } from '../../components/admin/staff/access'
import { MIN_PASSWORD, PASSWORD_HINT } from '../../components/admin/staff/common'
import { RoleSelect } from '../../components/admin/staff/RoleSelect'
import { isRole } from '../../components/admin/staff/roles'
import type { Route } from './+types/users-new'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'New staff member | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientLoader() {
  await requireAdmin()
  return null
}

export async function clientAction({ request }: Route.ClientActionArgs): Promise<ApiFailure> {
  await requireAdmin()
  const form = await request.formData()
  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const role = String(form.get('role') ?? '')
  const password = String(form.get('password') ?? '')
  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'Enter a name.'
  if (!email) fieldErrors.email = 'Enter an email address.'
  if (!isRole(role)) fieldErrors.role = 'Choose a role.'
  if (password.length < MIN_PASSWORD) fieldErrors.password = `Use at least ${MIN_PASSWORD} characters.`
  if (Object.keys(fieldErrors).length > 0 || !isRole(role)) {
    return { status: 0, formError: 'Please fix the highlighted fields.', fieldErrors }
  }
  const result = await safeCall(adminApi.POST('/admin/users', { body: { name, email, role, password } }))
  if (result.response.ok) throw redirect('/admin/users?saved=created')
  return handleApiError(result)
}

export default function NewStaff({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle'
  return (
    <>
      <p>
        <Link to="/admin/users">← Staff</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>New staff member</h1>
      <Form method="post" className="adm-form" noValidate>
        <FormError message={actionData?.formError} />
        <TextField name="name" label="Name" error={actionData?.fieldErrors.name} />
        <TextField name="email" label="Email" type="email" autoComplete="off" error={actionData?.fieldErrors.email} />
        <RoleSelect error={actionData?.fieldErrors.role} blank />
        <TextField
          name="password"
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={actionData?.fieldErrors.password}
        />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create staff member'}
          </button>
          <Link className="btn btn-light" to="/admin/users">
            Cancel
          </Link>
        </div>
      </Form>
    </>
  )
}
