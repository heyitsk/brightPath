import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { mailHref, telHref, useRootData } from './config'

/**
 * Sample-content notice. Shown only on pages that still show SAMPLE content; the route says
 * which part is sample through `handle.sample` (see root.tsx).
 */
export function SampleBand({ text }: { text: string }) {
  return (
    <div className="sample-band" role="note">
      <div className="wrap">
        <Icon name="alert" size={16} />
        <span>
          <strong>Sample content.</strong> {text}
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
          {phone && (
            <a href={telHref(phone)}>
              <Icon name="phone" size={15} />
              <span>{phone}</span>
            </a>
          )}
          {email && (
            <a href={mailHref(email)}>
              <Icon name="mail" size={15} />
              <span>{email}</span>
            </a>
          )}
          <MenuLink className="top-cta" item={navigation.counsellingCall} />
        </div>
      </div>
    </div>
  )
}
