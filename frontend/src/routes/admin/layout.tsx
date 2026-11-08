import { Form, NavLink, Outlet, redirect } from 'react-router'
import { adminApi } from '../../api/client.browser'
import { handleApiError, safeCall } from '../../api/errors'
import { sectionsFor } from '../../components/admin/sections'
import adminStyles from '../../styles/pages/admin.css?url'
import type { Route } from './+types/layout'

export const handle = { admin: true }
export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: adminStyles }]
export const meta: Route.MetaFunction = () => [
  { title: 'Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

/** Session check for everything under /admin: 401 → login; forced password change comes first. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const result = await safeCall(adminApi.GET('/admin/auth/me'))
  if (!('data' in result) || !result.data) {
    const failure = handleApiError(result)
    throw new Response(failure.formError, { status: failure.status || 503 })
  }
  const { user } = result.data
  const onChangePage = new URL(request.url).pathname === '/admin/change-password'
  if (user.mustChangePassword && !onChangePage) throw redirect('/admin/change-password')
  return { user }
}
clientLoader.hydrate = true as const

export function HydrateFallback() {
  return <div className="adm-center">Loading…</div>
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  const sections = user.mustChangePassword ? [] : sectionsFor(user.role)
  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">BrightPath admin</div>
        <p className="adm-who">
          <strong>{user.name}</strong>
          {user.role}
        </p>
        <nav aria-label="Admin sections">
          <ul className="adm-nav">
            {sections.map(({ label, href }) => (
              <li key={label}>
                {href ? (
                  <NavLink to={href}>{label}</NavLink>
                ) : (
                  <>
                    {label} <span className="soon">(coming soon)</span>
                  </>
                )}
              </li>
            ))}
            {!user.mustChangePassword && sections.length === 0 && (
              <li className="soon">No sections for your role yet.</li>
            )}
          </ul>
        </nav>
        <Form method="post" action="/admin/logout">
          <button className="btn btn-light btn-block" type="submit">
            Log out
          </button>
        </Form>
      </aside>
      <main className="adm-main" id="main">
        <Outlet />
      </main>
    </div>
  )
}

export function ErrorBoundary() {
  return (
    <main className="adm-center">
      <div className="adm-card">
        <h1 style={{ fontSize: '1.5rem', marginTop: 0 }}>Admin is unavailable</h1>
        <p>The staff area could not be loaded. Please try again in a moment.</p>
      </div>
    </main>
  )
}
