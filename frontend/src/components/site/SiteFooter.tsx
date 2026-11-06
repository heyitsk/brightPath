import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { mailHref, SLOT, telHref, useDisclaimer, useRootData } from './config'
import { MissingDisclaimer } from './MissingDisclaimer'

export function SiteFooter() {
  const { siteConfig, navigation, year } = useRootData()
  const { phone, email, officeAddress } = siteConfig.contact
  const notGuaranteed = useDisclaimer('NOT_GUARANTEED')
  const foreignColleges = useDisclaimer('FOREIGN_COLLEGES_NMC')

  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <p className="brand-name" style={{ fontSize: '1.25rem' }}>
              {siteConfig.brand.name ?? SLOT.brand}
            </p>
            <p style={{ color: 'var(--cover-muted)' }}>
              Counselling for MBBS admission in India and abroad. We show where every number comes from and when we
              last checked it.
            </p>
            <ul>
              <li>
                <a href={telHref(phone)}>
                  <Icon name="phone" size={16} />
                  &nbsp; <span className={phone ? undefined : 'slot'}>{phone ?? SLOT.phone}</span>&nbsp;(call or
                  WhatsApp)
                </a>
              </li>
              <li>
                <a href={mailHref(email)}>
                  <Icon name="mail" size={16} />
                  &nbsp; <span className={email ? undefined : 'slot'}>{email ?? SLOT.email}</span>
                </a>
              </li>
              <li>
                <span
                  className={officeAddress ? undefined : 'slot'}
                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 36 }}
                >
                  <Icon name="pin" size={16} /> {officeAddress ?? SLOT.address}
                </span>
              </li>
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
              {foreignColleges} © {year} [Company legal name] · [Registration details]
            </p>
          ) : (
            <MissingDisclaimer name="FOREIGN_COLLEGES_NMC" />
          )}
        </div>
      </div>
    </footer>
  )
}
