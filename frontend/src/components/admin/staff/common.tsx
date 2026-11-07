import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** Green success line after a redirect with ?saved=… (same look as the 2a lists). */
export function Flash({ children }: { children: ReactNode }) {
  return (
    <p className="callout" role="status" style={{ margin: '16px 0 0' }}>
      {children}
    </p>
  )
}

export function PageHead(props: { title: string; action?: { to: string; label: string } }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <h1 style={{ margin: 0 }}>{props.title}</h1>
      {props.action && (
        <Link className="btn btn-primary" to={props.action.to}>
          {props.action.label}
        </Link>
      )}
    </div>
  )
}

export function EmptyState({ items, filtered }: { items: string; filtered?: boolean }) {
  return (
    <p style={{ marginTop: 24 }}>
      {filtered ? 'No rows match these filters.' : `No ${items} yet. Add the first one.`}
    </p>
  )
}

export const PASSWORD_HINT =
  'At least 12 characters. This is a temporary password: the person must change it the first time they log in. Share it with them privately.'

export const MIN_PASSWORD = 12
