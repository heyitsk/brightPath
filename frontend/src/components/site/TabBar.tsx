import { useLocation } from 'react-router'
import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { useRootData } from './config'

/** Fixed bottom bar below 1080 px. */
export function TabBar() {
  const { navigation } = useRootData()
  const { pathname } = useLocation()
  return (
    <nav className="tabbar" aria-label="Quick links">
      {navigation.tabs.map(({ icon, label, item, talk }) => (
        <MenuLink
          key={label}
          item={item}
          className={talk ? 'talk' : undefined}
          aria-current={item.published && pathname === item.href ? 'page' : undefined}
        >
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </MenuLink>
      ))}
    </nav>
  )
}
