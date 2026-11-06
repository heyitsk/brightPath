import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router'
import type { DropMenu as DropMenuData, Navigation } from '../../data/navigation'
import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { MobileNav, MobileNavButton } from './MobileNav'
import { SLOT, telHref, useRootData } from './config'

/*
  Sticky navy cover bar: brand, "Explore colleges" mega menu, the four dropdowns,
  About, Contact, and below 1080 px the call button and menu button.

  Menus follow the disclosure pattern: a real <button aria-expanded aria-controls>
  shows or hides its panel. Enter/Space toggles, Escape closes and returns focus to
  the button, and moving focus out, clicking outside or changing page closes it.
  Pointer hover opens a panel too (with a short close delay), as in the preview.
  Before hydration the verbatim v3 CSS (:hover, :focus-within) does the work.
*/

const CLOSE_DELAY = 180

type MenuId = string
type MenuState = { key: string; open: MenuId | null; mobile: boolean }

const noopSubscribe = () => () => {}
/** False during server render and hydration, true once the client has taken over. */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

export function CoverBar() {
  const { siteConfig, navigation } = useRootData()
  const location = useLocation()
  const hydrated = useHydrated()
  // Menu state is tied to the current location, so a page change closes everything.
  const [state, setState] = useState<MenuState>({ key: location.key, open: null, mobile: false })
  const fresh = state.key === location.key
  const open = fresh ? state.open : null
  const mobileOpen = fresh ? state.mobile : false
  const update = (fn: (cur: { open: MenuId | null; mobile: boolean }) => Partial<MenuState>) =>
    setState((s) => {
      const cur = s.key === location.key ? { open: s.open, mobile: s.mobile } : { open: null, mobile: false }
      return { ...cur, ...fn(cur), key: location.key }
    })
  const setOpen = (fn: (cur: MenuId | null) => MenuId | null) => update((c) => ({ open: fn(c.open) }))
  const setMobileOpen = (fn: (cur: boolean) => boolean) => update((c) => ({ mobile: fn(c.mobile) }))
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  // Menu most recently opened by mouse hover; the click that follows keeps it open.
  const hoverOpened = useRef<MenuId | null>(null)

  // Close on a click or tap outside the header.
  useEffect(() => {
    if (!open && !mobileOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) {
        setState((st) => ({ ...st, open: null, mobile: false }))
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, mobileOpen])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const menuProps = (id: MenuId) => {
      const isOpen = open === id
      return {
        id,
        isOpen,
        hydrated,
        onToggle: () => {
          if (hoverOpened.current === id) {
            hoverOpened.current = null
            setOpen(() => id)
            return
          }
          setOpen((cur) => (cur === id ? null : id))
        },
        onClose: () => setOpen((cur) => (cur === id ? null : cur)),
        onPointerEnter: (e: React.PointerEvent) => {
          if (e.pointerType !== 'mouse') return
          window.clearTimeout(closeTimer.current)
          if (open !== id) hoverOpened.current = id
          setOpen(() => id)
        },
        onPointerLeave: (e: React.PointerEvent) => {
          if (e.pointerType !== 'mouse') return
          window.clearTimeout(closeTimer.current)
          hoverOpened.current = null
          closeTimer.current = window.setTimeout(() => setOpen((cur) => (cur === id ? null : cur)), CLOSE_DELAY)
        },
      }
  }

  const phone = siteConfig.contact.phone
  const brandName = siteConfig.brand.name ?? SLOT.brand

  return (
    <header
      className="cover"
      ref={headerRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && mobileOpen) {
          setMobileOpen(() => false)
          menuButtonRef.current?.focus()
        }
      }}
    >
      <div className="wrap">
        <Link className="brand" to="/">
          <span className="brand-logo" aria-hidden="true">
            LOGO
          </span>
          <span className="brand-name">
            {brandName}
            <small>MBBS admissions, India and abroad</small>
          </span>
        </Link>
        <ExploreMenu explore={navigation.explore} {...menuProps('explore')} />
        <nav className="nav" aria-label="Main">
          {navigation.dropdowns.map((menu) => (
            <DropMenu key={menu.id} menu={menu} whatsapp={navigation.whatsappExpert} {...menuProps(menu.id)} />
          ))}
          <MenuLink item={navigation.about} aria-current={current(navigation.about.href, location.pathname)} />
          <MenuLink item={navigation.contact} aria-current={current(navigation.contact.href, location.pathname)} />
        </nav>
        <a className="cover-call" href={telHref(phone)}>
          <Icon name="phone" size={18} />
          <span>{phone ?? SLOT.phone}</span>
          <b className="sr">Call us</b>
        </a>
        <MobileNavButton ref={menuButtonRef} open={mobileOpen} onToggle={() => setMobileOpen((o) => !o)} />
      </div>
      <MobileNav navigation={navigation} open={mobileOpen} />
    </header>
  )
}

function current(href: string, pathname: string) {
  return href === pathname ? ('page' as const) : undefined
}

type MenuProps = {
  id: string
  isOpen: boolean
  hydrated: boolean
  onToggle: () => void
  onClose: () => void
  onPointerEnter: (e: React.PointerEvent) => void
  onPointerLeave: (e: React.PointerEvent) => void
}

/** Shared keyboard and focus handling for one disclosure menu. */
function useDisclosure({ isOpen, onClose }: Pick<MenuProps, 'isOpen' | 'onClose'>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  return {
    rootRef,
    buttonRef,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation()
        onClose()
        buttonRef.current?.focus()
      }
    },
    onBlur: (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (isOpen && next && !rootRef.current?.contains(next)) onClose()
    },
  }
}

function stateClass(base: string, openClass: string, { isOpen, hydrated }: MenuProps) {
  if (!hydrated) return base
  return `${base} ${isOpen ? openClass : 'is-closed'}`
}

function ExploreMenu({ explore, ...props }: MenuProps & { explore: Navigation['explore'] }) {
  const { rootRef, buttonRef, onKeyDown, onBlur } = useDisclosure(props)
  const panelId = 'mega'
  return (
    <div
      ref={rootRef}
      className={stateClass('explore', 'menu-open', props)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        className="explore-btn"
        aria-expanded={props.isOpen}
        aria-controls={panelId}
        onClick={props.onToggle}
      >
        <Icon name="college" size={18} />
        <span>Explore colleges</span>
        <Icon name="chevron" size={16} />
      </button>
      <div className="mega" id={panelId} role="region" aria-label="Explore colleges">
        <div className="wrap mega-in">
          <div className="mega-abroad">
            <div className="mega-head">
              <h2>
                <Icon name="plane" size={18} /> Study abroad
              </h2>
              <span>{explore.abroadNote}</span>
            </div>
            <div className="mega-grid">
              {explore.countries.map((c) => (
                <div className="mega-col" key={c.href}>
                  <h3>
                    <MenuLink item={c} />
                  </h3>
                  {c.alert && (
                    <span className="mark red mega-alert">
                      <Icon name="alert" size={12} /> {c.alert.menu}
                    </span>
                  )}
                  <ul>
                    {c.colleges.map((college) => (
                      <li key={college.href}>
                        <MenuLink item={college} />
                      </li>
                    ))}
                  </ul>
                  <MenuLink className="mega-all" item={c}>
                    All {c.total} colleges in {c.label.replace(/^MBBS in /, '')} <Icon name="arrow" size={14} />
                  </MenuLink>
                </div>
              ))}
            </div>
            <p className="mega-next">Coming next: {explore.nextCountries.join(', ')}</p>
          </div>
          <div className="mega-india">
            <div className="mega-head">
              <h2>
                <Icon name="flag" size={18} /> Study in India
              </h2>
              <span>{explore.indiaNote}</span>
            </div>
            <ul className="mega-states">
              {explore.states.map((s) => (
                <li key={s.href}>
                  <MenuLink item={s}>
                    {s.label}
                    <span>{s.count ?? '[xx]'} colleges</span>
                  </MenuLink>
                </li>
              ))}
            </ul>
            <MenuLink className="btn btn-primary btn-block" item={explore.findColleges}>
              {explore.findColleges.label} <Icon name="arrow" size={18} />
            </MenuLink>
          </div>
        </div>
      </div>
    </div>
  )
}

function DropMenu({
  menu,
  whatsapp,
  ...props
}: MenuProps & { menu: DropMenuData; whatsapp: Navigation['whatsappExpert'] }) {
  const { rootRef, buttonRef, onKeyDown, onBlur } = useDisclosure(props)
  const panelId = `drop-${menu.id}`
  return (
    <div
      ref={rootRef}
      className={stateClass('drop', 'is-open', props)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        className="drop-btn"
        aria-expanded={props.isOpen}
        aria-controls={panelId}
        onClick={props.onToggle}
      >
        {menu.label}
        <Icon name="chevron" size={14} />
      </button>
      <div className="mega drop-panel" id={panelId} role="region" aria-label={menu.label}>
        <div className="wrap dp-in">
          <div className="dp-intro">
            <h2>{menu.title}</h2>
            <p>{menu.intro}</p>
            <MenuLink className="btn btn-primary" item={menu.primary}>
              {menu.primary.label} <Icon name="arrow" size={18} />
            </MenuLink>
            <MenuLink className="btn btn-secondary" item={whatsapp}>
              <Icon name="chat" size={18} /> {whatsapp.label}
            </MenuLink>
          </div>
          <div className="dp-cols">
            {menu.columns.map((col) => (
              <div className="dcol" key={col.title}>
                <h3>{col.title}</h3>
                <ul>
                  {col.items.map((item) => (
                    <li key={item.href + item.label}>
                      <MenuLink item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
