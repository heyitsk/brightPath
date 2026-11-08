import { Form, Link, redirect, useNavigation } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../api/errors'
import { FormError } from '../../components/admin/AdminFormError'
import { loadOrThrow } from '../../components/admin/crud/runtime'
import { SectionError } from '../../components/admin/crud/SectionError'
import type { StaffUser } from '../../components/admin/sections'
import { requireAdmin } from '../../components/admin/staff/access'
import type { Route } from './+types/users-status'

export { SectionError as ErrorBoundary }
export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Staff status | Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

async function loadTarget(id: string | undefined) {
  const me = await requireAdmin()
  if (!id) throw new Response('Not found.', { status: 404 })
  if (me.id === id) throw new Response('You cannot deactivate your own account.', { status: 403 })
  const data = await loadOrThrow<{ user: StaffUser }>(adminApi.GET('/admin/users/{id}', { params: { path: { id } } }))
  return data.user
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { user: await loadTarget(params.id) }
}

export async function clientAction({ params }: Route.ClientActionArgs): Promise<ApiFailure> {
  const user = await loadTarget(params.id)
  const result = await safeCall(
    adminApi.PATCH('/admin/users/{id}', { params: { path: { id: user.id } }, body: { isActive: !user.isActive } }),
  )
  if (result.response.ok) throw redirect(`/admin/users?saved=${user.isActive ? 'deactivated' : 'reactivated'}`)
  return handleApiError(result)
}

export default function UserStatus({ loaderData, actionData }: Route.ComponentProps) {
  const { user } = loaderData
  const busy = useNavigation().state !== 'idle'
  const verb = user.isActive ? 'Deactivate' : 'Reactivate'
  return (
    <div className="adm-card">
      <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>{verb} staff member?</h1>
      <p>
        <strong>{user.name}</strong> ({user.email})
      </p>
      <p>
        {user.isActive
          ? 'They will not be able to log in and their current sessions end immediately. You can reactivate them later.'
          : 'They will be able to log in again.'}
      </p>
      <Form method="post">
        <FormError message={actionData?.formError} />
        <div className="adm-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : verb}
          </button>
          <Link className="btn btn-light" to={`/admin/users/${user.id}`}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  )
}
