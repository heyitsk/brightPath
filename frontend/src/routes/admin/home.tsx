import { useRouteLoaderData } from 'react-router'
import type { Route } from './+types/home'
import type { clientLoader as layoutLoader } from './layout'

export const handle = { admin: true }
export const meta: Route.MetaFunction = () => [
  { title: 'Admin' },
  { name: 'robots', content: 'noindex, nofollow' },
]

export default function AdminHome() {
  const data = useRouteLoaderData<typeof layoutLoader>('routes/admin/layout')
  return (
    <>
      <h1 style={{ marginTop: 0 }}>Signed in</h1>
      <p>Welcome, {data?.user.name}. Admin sections will appear in the menu as they are built.</p>
    </>
  )
}
