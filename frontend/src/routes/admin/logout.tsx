import { redirect } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { safeCall } from '../../api/errors'
import type { Route } from './+types/logout'

export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [{ name: 'robots', content: 'noindex, nofollow' }]

/** Ends the session, then always goes to the login page (even if the session had already expired). */
export async function clientAction() {
  await safeCall(adminApi.POST('/admin/auth/logout'))
  throw redirect('/admin/login')
}

/** Opening /admin/logout directly just goes to the login page. */
export async function clientLoader() {
  throw redirect('/admin/login')
}
clientLoader.hydrate = true as const

export function HydrateFallback() {
  return <div className="adm-center">Loading…</div>
}
