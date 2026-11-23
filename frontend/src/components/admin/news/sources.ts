import { formatDate } from '../../shared/format'
import type { Opt } from '../crud/types'
import type { NewsSource, RunOutcome, SourceBody, SourceHealth, SourceKind, SourcePatch } from './types'

export const SOURCES_HREF = '/admin/news/sources'

/** The state select's value for a central body (MCC, NTA, NMC); sent as stateId: null. */
export const CENTRAL = 'central'

export const HEALTH_LABEL: Record<SourceHealth, string> = {
  OK: 'OK',
  DEGRADED: 'Having trouble',
  BROKEN: 'Not working',
}

export const KIND_LABEL: Record<SourceKind, string> = {
  RSS: 'RSS feed',
  WP_REST: 'WordPress API',
  HTML_LIST: 'Web page list',
  JSON_LIST: 'JSON list',
  HTML_JS: 'JavaScript page (cannot be read yet)',
}
const KINDS = Object.keys(KIND_LABEL) as SourceKind[]
export const KIND_OPTIONS: Opt[] = KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))
const isKind = (v: unknown): v is SourceKind => KINDS.includes(v as SourceKind)

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  OK: 'OK',
  NOT_MODIFIED: 'No change',
  ERROR: 'Failed',
  BLOCKED_BY_ROBOTS: 'Blocked by robots.txt',
}

export const CONFIG_HINT =
  'Reading settings as JSON, e.g. {"scope": "#notices"}. Web page list: scope (CSS selector of the area holding the notices; required), exclude, row, titleSelector, dateSelector, dateFromUrl, skipText, onlyText, skipHref, onlyHref, postbackLinks, minTitleLength, maxItems, order, generic. JSON list: itemsPath, titlePath, urlPath or urlTemplate, datePath, snippetPath, minTitleLength, maxItems, order. WordPress API: apiUrl. Any kind: allowInsecureTls. Leave {} when none are needed.'

export const MIN_INTERVAL = 15
export const MAX_INTERVAL = 1440
export const DEFAULT_INTERVAL = 180

/**
 * Switched-on sources that are not healthy come first (not working, then having trouble), the
 * same sources the API counts in `attentionCount`. The sort is stable, so the API's order stays.
 */
export function attentionRank(s: Pick<NewsSource, 'isActive' | 'status'>): number {
  if (s.isActive && s.status === 'BROKEN') return 0
  if (s.isActive && s.status === 'DEGRADED') return 1
  return 2
}

export const placeOf = (s: Pick<NewsSource, 'state'>) => s.state?.name ?? 'Central'

const pad = (v: number) => String(v).padStart(2, '0')

/** "12 Oct 2026, 14:05" in the browser's time zone. Admin pages render in the browser only. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return formatDate(iso)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${formatDate(local)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "850 ms" or "4.2 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The settings as shown in the textarea. */
export const configText = (config: Record<string, unknown>) => JSON.stringify(config, null, 2)

/** JSON with object keys sorted, so two settings objects compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** Every field the form can send; slug only on the new-source form. */
export type SourceValues = SourcePatch & { slug?: string }

/**
 * The form's values, checked in the browser first: the settings must be a JSON object and the
 * interval a whole number. A field that is not on the form is not sent.
 */
export function readSourceForm(form: FormData): { values: SourceValues; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  const text = (k: string) => String(form.get(k) ?? '').trim()
  const orNull = (k: string) => text(k) || null
  const values: SourceValues = {}

  if (form.has('slug')) values.slug = text('slug')
  if (form.has('name')) values.name = text('name')
  if (form.has('stateId')) {
    const s = text('stateId')
    values.stateId = s === CENTRAL || s === '' ? null : s
  }
  if (form.has('kind')) {
    const kind = text('kind')
    if (isKind(kind)) values.kind = kind
    else fieldErrors.kind = 'Choose how the source is read.'
  }
  if (form.has('listUrl')) values.listUrl = text('listUrl')
  if (form.has('siteUrl')) values.siteUrl = orNull('siteUrl')
  if (form.has('notes')) values.notes = orNull('notes')
  // An unticked checkbox is not in the form data; the marker says the box was on the form.
  if (form.has('isActiveShown')) values.isActive = form.get('isActive') === 'on'

  const interval = text('fetchIntervalMin')
  if (interval !== '') {
    const minutes = Number(interval)
    if (!Number.isInteger(minutes) || minutes < MIN_INTERVAL || minutes > MAX_INTERVAL) {
      fieldErrors.fetchIntervalMin = `A whole number of minutes from ${MIN_INTERVAL} to ${MAX_INTERVAL}.`
    } else values.fetchIntervalMin = minutes
  }

  if (form.has('config')) {
    const raw = text('config')
    if (raw === '') values.config = {}
    else {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          values.config = parsed as Record<string, unknown>
        } else fieldErrors.config = 'The settings must be a JSON object, written between { and }.'
      } catch (e) {
        fieldErrors.config = `The settings are not valid JSON: ${e instanceof Error ? e.message : 'check the commas and quotes'}.`
      }
    }
  }

  for (const k of ['slug', 'name', 'listUrl'] as const) {
    if (values[k] === '') fieldErrors[k] = 'Required.'
  }
  return { values, fieldErrors }
}

/** The body for POST: the form must have given every required field. */
export function createBody(values: SourceValues): SourceBody | null {
  const { slug, name, kind, listUrl } = values
  if (!slug || !name || !kind || !listUrl) return null
  return { ...values, slug, name, kind, listUrl }
}

/** Only what differs from the stored source (slug never changes). */
export function sourceChanges(values: SourceValues, s: NewsSource): SourcePatch {
  const out: SourcePatch = {}
  if (values.name !== undefined && values.name !== s.name) out.name = values.name
  if (values.stateId !== undefined && values.stateId !== (s.state?.id ?? null)) out.stateId = values.stateId
  if (values.kind !== undefined && values.kind !== s.kind) out.kind = values.kind
  if (values.listUrl !== undefined && values.listUrl !== s.listUrl) out.listUrl = values.listUrl
  if (values.siteUrl !== undefined && values.siteUrl !== (s.siteUrl || null)) out.siteUrl = values.siteUrl
  if (values.notes !== undefined && values.notes !== (s.notes || null)) out.notes = values.notes
  if (values.isActive !== undefined && values.isActive !== s.isActive) out.isActive = values.isActive
  if (values.fetchIntervalMin !== undefined && Number(values.fetchIntervalMin) !== Number(s.fetchIntervalMin)) {
    out.fetchIntervalMin = values.fetchIntervalMin
  }
  if (values.config !== undefined && stable(values.config) !== stable(s.config)) out.config = values.config
  return out
}

/** API field errors under `config.scope` and the like are shown next to the settings box. */
export function withConfigErrors(fieldErrors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, message] of Object.entries(fieldErrors)) {
    if (path === 'config' || !path.startsWith('config')) out[path] ??= message
    else {
      const key = path.replace(/^config[./]?/, '')
      const line = key ? `${key}: ${message}` : message
      out.config = out.config ? `${out.config} ${line}` : line
    }
  }
  return out
}
