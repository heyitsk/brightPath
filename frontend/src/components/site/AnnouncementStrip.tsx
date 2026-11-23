import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { Icon } from '../Icon'
import { useSiteConfig } from './config'

/*
  Dismiss memory for the announcement strip. Only the id of the last dismissed announcement is
  kept, so a new or reworded announcement (new id) shows again. Storage can be missing or throw
  (private windows, blocked site data), so every access is guarded and `sessionDismissed` keeps
  the strip closed for this page view even when nothing could be stored.
*/
const STORAGE_KEY = 'bp:announcement-dismissed'
const listeners = new Set<() => void>()
let sessionDismissed: string | null = null

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

const getSnapshot = () => sessionDismissed ?? readStored()
// Server render and hydration always show the strip; the stored choice applies right after.
const getServerSnapshot = () => null

function dismiss(id: string) {
  sessionDismissed = id
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Not stored: the strip stays closed for this page view only.
  }
  for (const l of listeners) l()
}

/** Thin strip above the header with the admin's current announcement. Nothing when there is none. */
export function AnnouncementStrip() {
  const announcement = useSiteConfig().announcement
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (!announcement || dismissed === announcement.id) return null

  const { id, text, linkLabel, linkUrl } = announcement
  // A path on this site goes through the router; a full https:// address is a plain link.
  let link = null
  if (linkLabel && linkUrl) {
    link = linkUrl.startsWith('/') ? <Link to={linkUrl}>{linkLabel}</Link> : <a href={linkUrl}>{linkLabel}</a>
  }
  return (
    <div className="announce" role="region" aria-label="Announcement">
      <div className="wrap">
        <p>
          {text}
          {link && <> {link}</>}
        </p>
        <button type="button" className="announce-close" aria-label="Dismiss announcement" onClick={() => dismiss(id)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
