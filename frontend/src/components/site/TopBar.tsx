import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { mailHref, SLOT, telHref, useRootData } from './config'

/** Sample-data notice, shown while menus and records are SAMPLE data. */
export function SampleBand() {
  return (
    <div className="sample-band" role="note">
      <div className="wrap">
        <Icon name="alert" size={16} />
        <span>
          <strong>Design preview.</strong> College names come from our research list. Every number, date and
          status on this page is sample data and has not been checked.
        </span>
      </div>
    </div>
  )
}

/** Dark strip above the cover bar, from 1080 px: tool links and contact. */
export function TopBar() {
  const { siteConfig, navigation } = useRootData()
  const { phone, email } = siteConfig.contact
  return (
    <div className="topbar">
      <div className="wrap">
        <nav className="tools" aria-label="Tools">
          {navigation.tools.map(({ icon, item }) => (
            <MenuLink key={item.label} item={item}>
              <Icon name={icon} size={16} />
              <span>{item.label}</span>
            </MenuLink>
          ))}
        </nav>
        <div className="top-contact">
          <a href={telHref(phone)}>
            <Icon name="phone" size={15} />
            <span>{phone ?? SLOT.phone}</span>
          </a>
          <a href={mailHref(email)}>
            <Icon name="mail" size={15} />
            <span>{email ?? SLOT.email}</span>
          </a>
          <MenuLink className="top-cta" item={navigation.counsellingCall} />
        </div>
      </div>
    </div>
  )
}
