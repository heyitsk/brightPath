import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { mailHref, telHref, useDisclaimer, useRootData } from './config'
import { MissingDisclaimer } from './MissingDisclaimer'

export function SiteFooter() {
  const { siteConfig, navigation, year } = useRootData()
  const { phone, email, officeAddress } = siteConfig.contact
  const brand = siteConfig.brand.name
  const notGuaranteed = useDisclaimer('NOT_GUARANTEED')
  const foreignColleges = useDisclaimer('FOREIGN_COLLEGES_NMC')

  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            {brand && (
              <p className="brand-name" style={{ fontSize: '1.25rem' }}>
                {brand}
              </p>
            )}
            <p style={{ color: 'var(--cover-muted)' }}>
              Counselling for MBBS admission in India and abroad. We show where every number comes from and when we
              last checked it.
            </p>
            <ul>
              {phone && (
                <li>
                  <a href={telHref(phone)}>
                    <Icon name="phone" size={16} />
                    &nbsp; <span>{phone}</span>&nbsp;(call or WhatsApp)
                  </a>
                </li>
              )}
              {email && (
                <li>
                  <a href={mailHref(email)}>
                    <Icon name="mail" size={16} />
                    &nbsp; <span>{email}</span>
                  </a>
                </li>
              )}
              {officeAddress && (
                <li>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 36 }}>
                    <Icon name="pin" size={16} /> {officeAddress}
                  </span>
                </li>
              )}
            </ul>
          </div>
          {navigation.footer.map((col) => (
            <div key={col.title}>
              <h2>{col.title}</h2>
              <ul>
                {col.items.map((item) => (
                  <li key={item.label}>
                    <MenuLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="foot-legal">
          {notGuaranteed ? <p>{notGuaranteed}</p> : <MissingDisclaimer name="NOT_GUARANTEED" />}
          {foreignColleges ? (
            <p>
              {foreignColleges} © {year}
              {brand ? ` ${brand}` : ''}
            </p>
          ) : (
            <MissingDisclaimer name="FOREIGN_COLLEGES_NMC" />
          )}
        </div>
      </div>
    </footer>
  )
}
