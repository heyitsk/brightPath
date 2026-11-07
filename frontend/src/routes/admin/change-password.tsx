import { Form, redirect, useNavigation, useRouteLoaderData } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { FormError, TextField } from '../../components/admin/AdminFormError'
import type { Route } from './+types/change-password'
import type { clientLoader as layoutLoader } from './layout'

export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Change password' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData()
  const currentPassword = String(form.get('currentPassword') ?? '')
  const newPassword = String(form.get('newPassword') ?? '')
  const result = await safeCall(
    adminApi.POST('/admin/auth/change-password', { body: { currentPassword, newPassword } }),
  )
  if (result.response.ok) throw redirect('/admin')
  return handleApiError(result)
}

export default function ChangePassword({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting'
  const data = useRouteLoaderData<typeof layoutLoader>('routes/admin/layout')
  const forced = data?.user.mustChangePassword
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Change password</h1>
      {forced && <p>You must set a new password before you can use the admin area.</p>}
      <Form method="post" noValidate>
        <FormError message={actionData?.formError} />
        <TextField name="currentPassword" label="Current password" type="password" autoComplete="current-password" error={actionData?.fieldErrors.currentPassword} />
        <TextField
          name="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters, not containing your email, different from the current one."
          error={actionData?.fieldErrors.newPassword}
        />
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </Form>
    </div>
  )
}
