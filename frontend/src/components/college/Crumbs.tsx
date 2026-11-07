import type { NavItem } from '../../data/navigation'
import { MenuLink } from '../site/MenuLink'

/** Breadcrumb trail. Parents that are not built yet render as plain text, the last item is the page. */
export function Crumbs({ parents, current }: { parents: NavItem[]; current: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {parents.map((p) => (
          <li key={p.label}>{p.published ? <MenuLink item={p} /> : p.label}</li>
        ))}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  )
}
