import type { ReactNode } from 'react'
import { useRouteLoaderData } from 'react-router'
import type { clientLoader as layoutLoader } from '../../../routes/admin/layout'
import { canOpen } from '../sections'
import { SectionMessage } from './SectionError'

/**
 * Shows the page only to roles whose menu has `href`. For pages whose list the API also serves to
 * other roles (a COUNSELLOR may read states and news sources to filter the review queue).
 * Uses the user the admin layout already loaded: no extra request.
 */
export function RequireSection({ href, children }: { href: string; children: ReactNode }) {
  const user = useRouteLoaderData<typeof layoutLoader>('routes/admin/layout')?.user
  if (!user || !canOpen(user.role, href)) {
    return <SectionMessage title="Error 403" detail="Your role cannot use this section." />
  }
  return children
}
