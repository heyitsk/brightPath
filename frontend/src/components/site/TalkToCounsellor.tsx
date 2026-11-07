import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { MenuLink } from './MenuLink'
import { SLOT, telHref, useDisclaimer, useSiteConfig, whatsappHref } from './config'
import { MissingDisclaimer } from './MissingDisclaimer'

/** "Talk to a counsellor" band with the call-back form. Shared by the home and college pages. */
export function TalkToCounsellor() {
  const config = useSiteConfig()
  const { phone, whatsapp, callbackHours } = config.contact
  const consent = useDisclaimer('ENQUIRY_CONSENT')
  const brand = config.brand.name ?? SLOT.brand
  const privacy = { label: 'Privacy policy', href: '/privacy', published: false }

  return (
    <section id="talk" className="section band-cover rosette" style={{ '--rose-img': 'var(--rose-navy)' } as CSSProperties}>
      <div className="wrap split">
        <div>
          <h2>Talk to a counsellor</h2>
          <p style={{ color: 'var(--cover-muted)', marginTop: 12 }}>
            Leave your number and a counsellor calls you back. If you've used the tools, they'll already have your
            score, rank and shortlist, so you won't have to repeat yourself.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
            <a className="btn btn-light" href={telHref(phone)}>
              <Icon name="phone" /> Call {phone ?? SLOT.phone}
            </a>
            <a className="btn btn-light" href={whatsappHref(whatsapp ?? phone)}>
              <Icon name="chat" /> WhatsApp us
            </a>
          </div>
          <p className="small" style={{ color: 'var(--cover-muted)', marginTop: 16 }}>
            Open {callbackHours ?? SLOT.hours}. We never share your number with colleges or agents.
          </p>
        </div>
        {/* Not connected yet: the backend has no enquiry endpoint. Wired up in the enquiry step. */}
        <form className="visa security" style={{ color: 'var(--ink)' }} noValidate onSubmit={(e) => e.preventDefault()}>
          <div className="visa-head">
            <h3>Request a call back</h3>
          </div>
          <div className="field">
            <label htmlFor="n1">Your name</label>
            <input className="input" id="n1" name="name" autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="p1">Mobile number</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span
                className="input"
                style={{
                  width: 72,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--paper-2)',
                }}
              >
                +91
              </span>
              <input
                className="input"
                id="p1"
                name="phone"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="10-digit number"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="c1">City</label>
            <input className="input" id="c1" name="city" autoComplete="address-level2" />
          </div>
          {consent ? (
            <label className="check">
              <input type="checkbox" name="consent" />
              <span>
                {consent.replaceAll('{brandName}', brand)} <MenuLink item={privacy} />
              </span>
            </label>
          ) : (
            <MissingDisclaimer name="ENQUIRY_CONSENT" />
          )}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            style={{ marginTop: 12 }}
            disabled
            aria-describedby="callback-off"
          >
            Request a call back
          </button>
          <p id="callback-off" className="small muted" style={{ margin: '8px 0 0' }}>
            Call back requests are not connected yet.
          </p>
        </form>
      </div>
    </section>
  )
}
