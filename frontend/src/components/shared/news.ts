/*
  Wording for news notices, shared by the public News pages and the admin review queue.
  Browser-safe: no API client here (admin/news/data.ts uses the admin client, so public pages
  must not import it).
*/
import type { paths } from '../../api/schema'
import { formatDate, NO_DATE } from './format'

type PublicItem = paths['/news/']['get']['responses'][200]['content']['application/json']['items'][number]
export type NewsCategory = PublicItem['category']
export type DateBasis = PublicItem['dateBasis']

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
export const isNewsCategory = (v: unknown): v is NewsCategory => typeof v === 'string' && v in CATEGORY_LABEL

/**
 * The date of a notice with where it came from: the official site, the notice PDF, or (when the
 * site gives no date) the `fallback` line. Never presents our own date as the site's date.
 */
export function noticeDateLine(basis: DateBasis, date: string | null | undefined, fallback: () => string): string {
  if (basis === 'SOURCE' && date) return `Dated ${formatDate(date)} on the official site`
  if (basis === 'PDF' && date) return `Dated ${formatDate(date)} in the notice PDF`
  return fallback()
}

/** A notice without a site date: when our fetcher first found it. Same words on the public and admin pages. */
export const firstSeenLine = (firstSeenAt: string) => `First seen by us on ${formatDate(firstSeenAt)} (the site gives no date)`

type PublicNotice = Pick<PublicItem, 'dateBasis' | 'sourcePublishedOn' | 'firstSeenAt' | 'checkedOn' | 'state'>

/** The date line on the public pages. */
export const publicDateLine = (item: PublicNotice) =>
  noticeDateLine(item.dateBasis, item.sourcePublishedOn, () => firstSeenLine(item.firstSeenAt))

export const checkedLine = (item: Pick<PublicNotice, 'checkedOn'>) =>
  item.checkedOn ? `Checked on ${formatDate(item.checkedOn)}` : `Checked on: ${NO_DATE}`

/** The state a notice is about, or "Central" for national notices (MCC, NMC, NTA). */
export const placeName = (item: Pick<PublicNotice, 'state'>) => item.state?.name ?? 'Central'
