import type { Ref } from 'react'
import type { Navigation } from '../../data/navigation'
import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'

export const MOBILE_NAV_ID = 'mnav'

/** Menu button below 1080 px. Opens the navy sheet. */
export function MobileNavButton({
  open,
  onToggle,
  ref,
}: {
  open: boolean
  onToggle: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="menu-btn"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      aria-controls={MOBILE_NAV_ID}
      onClick={onToggle}
    >
      <Icon name={open ? 'close' : 'menu'} size={24} />
    </button>
  )
}

/** The phone menu sheet: explore groups, course and exam groups, tool links. */
export function MobileNav({ navigation, open }: { navigation: Navigation; open: boolean }) {
  const { explore, dropdowns, tools, about, contact } = navigation
  return (
    <nav className={open ? 'mobile-nav open' : 'mobile-nav'} id={MOBILE_NAV_ID} aria-label="Main">
      <p className="m-title">Explore colleges</p>
      <div className="m-explore">
        <p className="m-label">
          <Icon name="plane" size={16} /> Study abroad
        </p>
        {explore.countries.map((c, i) => (
          <details key={c.href} open={i === 0}>
            <summary>
              {c.label}
              <span className="cnt">{c.total ?? '[xx]'}</span>
              {c.alert && (
                <>
                  {' '}
                  <span className="mark red" style={{ marginLeft: 6 }}>
                    <Icon name="alert" size={12} /> {c.alert.mobile}
                  </span>
                </>
              )}
              <Icon name="chevron" size={18} />
            </summary>
            <ul>
              {c.mobileColleges.map((college) => (
                <li key={college.href}>
                  <MenuLink item={college} />
                </li>
              ))}
              <li>
                <MenuLink className="mega-all" item={c}>
                  All {c.total ?? '[xx]'} colleges <Icon name="arrow" size={14} />
                </MenuLink>
              </li>
            </ul>
          </details>
        ))}
        <p className="m-label">
          <Icon name="flag" size={16} /> Study in India
        </p>
        <details>
          <summary>
            NEET counselling by state
            <Icon name="chevron" size={18} />
          </summary>
          <ul>
            {explore.states.map((s) => (
              <li key={s.href}>
                <MenuLink item={s} />
              </li>
            ))}
          </ul>
        </details>
      </div>
      <p className="m-label">
        <Icon name="book" size={16} /> Courses and exams
      </p>
      <div className="m-explore">
        {dropdowns.map((menu) => (
          <details key={menu.id}>
            <summary>
              {menu.label}
              <Icon name="chevron" size={18} />
            </summary>
            <ul>
              {menu.mobileItems.map((item) => (
                <li key={item.href + item.label}>
                  <MenuLink item={item} />
                </li>
              ))}
              <li>
                <MenuLink className="mega-all" item={menu.seeAll}>
                  See all <Icon name="arrow" size={14} />
                </MenuLink>
              </li>
            </ul>
          </details>
        ))}
      </div>
      <p className="m-label">
        <Icon name="chart" size={16} /> Tools
      </p>
      <div className="m-links">
        {tools.map(({ item }) => (
          <MenuLink key={item.label} item={item} />
        ))}
        <MenuLink item={about} />
        <MenuLink item={contact} />
      </div>
    </nav>
  )
}
