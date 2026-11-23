import type { paths } from '../../../api/schema'

export type Homepage = paths['/admin/site/homepage']['get']['responses'][200]['content']['application/json']
export type PatchBody = paths['/admin/site/homepage']['patch']['requestBody']['content']['application/json']
export type StripStatus = Homepage['announcement']['status']

export type HomepageDone = { ok: true; message: string; at: number }
export type HomepageFailed = { ok: false; formError?: string; fieldErrors: Record<string, string>; at: number }

/** Form field names are the API's dotted paths, so 422 field errors line up with inputs. */
export const F = {
  headline: 'hero.headline',
  subtext: 'hero.subtext',
  text: 'announcement.text',
  linkLabel: 'announcement.linkLabel',
  linkUrl: 'announcement.linkUrl',
  isActive: 'announcement.isActive',
  showFrom: 'announcement.showFrom',
  showUntil: 'announcement.showUntil',
} as const
const KNOWN = new Set<string>(Object.values(F))

/** The form as typed: trimmed text with empty meaning "clear" (null), times as ISO strings. */
type Draft = {
  hero: { headline: string | null; subtext: string | null }
  announcement: {
    text: string | null
    linkLabel: string | null
    linkUrl: string | null
    isActive: boolean
    showFrom: string | null
    showUntil: string | null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO time -> `YYYY-MM-DDTHH:mm` in the browser's time zone, for `<input type="datetime-local">`. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `datetime-local` value (local time) -> ISO. Empty -> null; anything unreadable -> undefined. */
function fromLocalInput(value: string): string | null | undefined {
  if (value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim() || null

/** Reads the form. Returns field errors instead when a time cannot be read. */
export function readForm(form: FormData): { draft: Draft } | { fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  const time = (name: string) => {
    const v = fromLocalInput(String(form.get(name) ?? ''))
    if (v === undefined) fieldErrors[name] = 'Enter a full date and time, or leave it empty.'
    return v ?? null
  }
  const draft: Draft = {
    hero: { headline: text(form, F.headline), subtext: text(form, F.subtext) },
    announcement: {
      text: text(form, F.text),
      linkLabel: text(form, F.linkLabel),
      linkUrl: text(form, F.linkUrl),
      isActive: form.get(F.isActive) === 'on',
      showFrom: time(F.showFrom),
      showUntil: time(F.showUntil),
    },
  }
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : { draft }
}

const sameText = (typed: string | null, stored: string | null) => typed === (stored?.trim() || null)

/** Same minute, because the input has no seconds; a save must not resend an unchanged time. */
function sameMinute(a: string | null, b: string | null) {
  if (a === null || b === null) return a === b
  return Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000)
}

/** Only the fields that differ from what is stored, or null when nothing changed. */
export function diff(draft: Draft, stored: Homepage): { body: PatchBody; count: number } | null {
  const hero: NonNullable<PatchBody['hero']> = {}
  const announcement: NonNullable<PatchBody['announcement']> = {}
  const h = draft.hero
  const a = draft.announcement
  const s = stored.announcement

  if (!sameText(h.headline, stored.hero.headline)) hero.headline = h.headline
  if (!sameText(h.subtext, stored.hero.subtext)) hero.subtext = h.subtext
  if (!sameText(a.text, s.text)) announcement.text = a.text
  if (!sameText(a.linkLabel, s.linkLabel)) announcement.linkLabel = a.linkLabel
  if (!sameText(a.linkUrl, s.linkUrl)) announcement.linkUrl = a.linkUrl
  if (a.isActive !== s.isActive) announcement.isActive = a.isActive
  if (!sameMinute(a.showFrom, s.showFrom)) announcement.showFrom = a.showFrom
  if (!sameMinute(a.showUntil, s.showUntil)) announcement.showUntil = a.showUntil

  const count = Object.keys(hero).length + Object.keys(announcement).length
  if (count === 0) return null
  const body: PatchBody = {}
  if (Object.keys(hero).length > 0) body.hero = hero
  if (Object.keys(announcement).length > 0) body.announcement = announcement
  return { body, count }
}

/**
 * Splits API field errors into the ones shown next to a field (paths like `announcement.text` or
 * `/announcement/text`) and the rest, which are added to the form-level message.
 */
export function splitFieldErrors(fieldErrors: Record<string, string>) {
  const byField: Record<string, string> = {}
  const rest: string[] = []
  for (const [path, message] of Object.entries(fieldErrors)) {
    const name = path.replace(/^\//, '').replace(/\//g, '.')
    if (KNOWN.has(name)) byField[name] = byField[name] ? `${byField[name]} ${message}` : message
    else rest.push(message)
  }
  return { byField, rest }
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''

/** Badge and plain sentence for the strip's status: what visitors see right now. */
export function statusOf(a: Homepage['announcement']): { label: string; badge: string; text: string } {
  switch (a.status) {
    case 'LIVE':
      return {
        label: 'Live',
        badge: 'adm-badge on',
        text: a.showUntil
          ? `Visitors see the strip now, until ${when(a.showUntil)}.`
          : 'Visitors see the strip now, until it is switched off.',
      }
    case 'SCHEDULED':
      return {
        label: 'Scheduled',
        badge: 'adm-badge pub',
        text: `Switched on. Visitors see the strip from ${when(a.showFrom)}.`,
      }
    case 'EXPIRED':
      return {
        label: 'Expired',
        badge: 'adm-badge off',
        text: `The end time passed on ${when(a.showUntil)}. Visitors see no strip.`,
      }
    case 'EMPTY':
      return { label: 'Empty', badge: 'adm-badge', text: 'There is no text, so visitors see no strip.' }
    case 'OFF':
      return { label: 'Off', badge: 'adm-badge', text: 'Switched off. Visitors see no strip.' }
  }
}
