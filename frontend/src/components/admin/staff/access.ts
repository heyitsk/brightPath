import { adminApi } from '../../../api/client.browser'
import { handleApiError, safeCall } from '../../../api/errors'
import type { StaffUser } from '../sections'

/** Current staff member for ADMIN-only pages. Anyone else gets a 403 that the page shows (the API refuses them too). */
export async function requireAdmin(): Promise<StaffUser> {
  const result = await safeCall(adminApi.GET('/admin/auth/me'))
  if (!('data' in result) || !result.data) {
    const failure = handleApiError(result)
    throw new Response(failure.formError, { status: failure.status || 503 })
  }
  const { user } = result.data
  if (user.role !== 'ADMIN') {
    throw new Response('Only administrators can use this section.', { status: 403 })
  }
  return user
}
