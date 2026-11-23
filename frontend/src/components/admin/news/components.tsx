import { HEALTH_LABEL } from './sources'
import { STATUS_LABEL } from './data'
import type { NewsStatus, SourceHealth } from './types'

export function NewsStatusBadge({ status }: { status: NewsStatus }) {
  const cls =
    status === 'PUBLISHED'
      ? 'adm-badge pub'
      : status === 'PENDING'
        ? 'adm-badge on'
        : status === 'REJECTED'
          ? 'adm-badge off'
          : 'adm-badge'
  return <span className={cls}>{STATUS_LABEL[status]}</span>
}

/** Link to the official original, always in a new tab. */
export function OriginalLink({ href, className, children }: { href: string; className?: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={`${children} (opens in a new tab)`}
    >
      {children} ↗
    </a>
  )
}

export function HealthBadge({ status }: { status: SourceHealth }) {
  const cls = status === 'OK' ? 'adm-badge on' : status === 'BROKEN' ? 'adm-badge off' : 'adm-badge'
  return <span className={cls}>{HEALTH_LABEL[status]}</span>
}

export function OnOffBadge({ on }: { on: boolean }) {
  return <span className="adm-badge">{on ? 'On' : 'Off'}</span>
}
