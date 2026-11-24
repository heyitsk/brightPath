import { adminApi } from '../../../api/client.browser'
import { loadOrThrow } from '../crud/runtime'
import { formatDate } from '../../shared/format'
import { CATEGORY_LABEL, firstSeenLine, isNewsCategory, noticeDateLine } from '../../shared/news'
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

export { CATEGORY_LABEL }
export const CATEGORY_OPTIONS: Opt[] = (Object.keys(CATEGORY_LABEL) as NewsCategory[]).map((c) => ({
  value: c,
  label: CATEGORY_LABEL[c],
}))
export const isCategory = (v: unknown): v is NewsCategory => isNewsCategory(v)

/** The date of a notice with where it came from. Never presents our first sighting as the site's date. */
export function dateLine(item: Pick<NewsListItem, 'dateBasis' | 'sourcePublishedAt' | 'firstSeenAt'>): string {
  return noticeDateLine(item.dateBasis, item.sourcePublishedAt, () => firstSeenLine(item.firstSeenAt))
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

type Named = { items: { id: string; name: string }[] }
const toChoices = ({ items }: Named): Opt[] => items.map((x) => ({ value: x.id, label: x.name }))

/** Choices for the state select and filter. Any failure throws for the section ErrorBoundary. */
export async function loadStateChoices(): Promise<Opt[]> {
  return toChoices(await loadOrThrow<Named>(adminApi.GET('/admin/states')))
}

/** Choices for the source filter (a COUNSELLOR gets short rows, which still have id and name). */
export async function loadSourceChoices(): Promise<Opt[]> {
  return toChoices(await loadOrThrow<Named>(adminApi.GET('/admin/news/sources')))
}
