import { adminApi } from '../../../api/client.browser'
import { handleApiError, safeCall } from '../../../api/errors'
import { formatDate } from '../../shared/format'
import type { Opt } from '../crud/types'
import type { NewsCategory, NewsListItem, NewsStatus } from './types'

/** Whole numbers arrive as string | number. */
export const n = (v: string | number | null | undefined) => Number(v ?? 0)

export const STATUS_LABEL: Record<NewsStatus, string> = {
  PENDING: 'To review',
  FILTERED: 'Filtered out',
  PUBLISHED: 'Published',
  UNPUBLISHED: 'Unpublished',
  REJECTED: 'Rejected',
  BASELINE: 'Old, hidden',
}
export const STATUSES = Object.keys(STATUS_LABEL) as NewsStatus[]
export const isStatus = (v: unknown): v is NewsStatus => STATUSES.includes(v as NewsStatus)

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  COUNSELLING: 'Counselling',
  SCHEDULE: 'Schedule',
  SEAT_MATRIX: 'Seat matrix',
  MERIT_LIST: 'Merit list',
  REGISTRATION: 'Registration',
  RESULT: 'Result',
  FEE: 'Fee',
  OTHER: 'Other',
}
export const CATEGORY_OPTIONS: Opt[] = (Object.keys(CATEGORY_LABEL) as NewsCategory[]).map((c) => ({
  value: c,
  label: CATEGORY_LABEL[c],
}))
export const isCategory = (v: unknown): v is NewsCategory => typeof v === 'string' && v in CATEGORY_LABEL

/** The date of a notice with where it came from. Never presents our first sighting as the site's date. */
export function dateLine(item: Pick<NewsListItem, 'dateBasis' | 'sourcePublishedAt' | 'firstSeenAt'>): string {
  const { dateBasis, sourcePublishedAt } = item
  if (dateBasis === 'SOURCE' && sourcePublishedAt) return `Dated ${formatDate(sourcePublishedAt)} on the official site`
  if (dateBasis === 'PDF' && sourcePublishedAt) return `Dated ${formatDate(sourcePublishedAt)} in the notice PDF`
  return `First seen by us on ${formatDate(item.firstSeenAt)} (the site gives no date)`
}

/** The same date for the list column, e.g. "5 Nov 2026 · official site". */
export function shortDateLine(item: Pick<NewsListItem, 'dateBasis' | 'sourcePublishedAt' | 'firstSeenAt'>): string {
  const { dateBasis, sourcePublishedAt } = item
  if (dateBasis === 'SOURCE' && sourcePublishedAt) return `${formatDate(sourcePublishedAt)} · official site`
  if (dateBasis === 'PDF' && sourcePublishedAt) return `${formatDate(sourcePublishedAt)} · notice PDF`
  return `${formatDate(item.firstSeenAt)} · first seen`
}

/** Cuts long text to about `max` characters at a word break, ending with "…". */
export function shorten(text: string, max = 60): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export const placeLabel = (item: Pick<NewsListItem, 'state'>) => item.state?.name ?? 'Central'

/** The title shown on the News page: the staff title, else the official one. */
export const shownTitle = (item: Pick<NewsListItem, 'publicTitle' | 'title'>) => item.publicTitle || item.title

/**
 * Choices for a select that only EDITOR and ADMIN may load. A 403 (a COUNSELLOR) gives null,
 * so the page hides that control. Any other failure throws for the section ErrorBoundary.
 */
async function optional(call: Promise<{ data?: unknown; error?: unknown; response: Response }>, pick: (data: unknown) => Opt[]) {
  const result = await safeCall(call)
  const data = (result as { data?: unknown }).data
  if (result.response.ok && data !== undefined) return pick(data)
  const failure = handleApiError(result)
  if (failure.status === 403) return null
  throw new Response(failure.formError, { status: failure.status || 503 })
}

export function loadStateChoices(): Promise<Opt[] | null> {
  return optional(adminApi.GET('/admin/states'), (data) =>
    (data as { items: { id: string; name: string }[] }).items.map((s) => ({ value: s.id, label: s.name })),
  )
}

export function loadSourceChoices(): Promise<Opt[] | null> {
  return optional(adminApi.GET('/admin/news/sources'), (data) =>
    (data as { items: { id: string; name: string }[] }).items.map((s) => ({ value: s.id, label: s.name })),
  )
}
