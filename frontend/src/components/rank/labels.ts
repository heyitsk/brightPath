import type { operations } from '../../api/schema'
import { formatDate, formatNumber, NO_DATE } from '../shared/format'

type Ok<Op extends keyof operations> = operations[Op] extends {
  responses: { 200: { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type RankResponse = Ok<'getNeetRank'>
export type RankResultData = RankResponse['result']
export type OtherYear = RankResponse['otherYears'][number]
export type RankRange = NonNullable<RankResultData['allIndiaRank']>
export type DataSourcesResponse = Ok<'getNeetData-sources'>
export type DataSourceYear = DataSourcesResponse['years'][number]
export type Category = operations['getNeetRank']['parameters']['query']['category']
export type Basis = NonNullable<RankResultData['basis']>
export type Group = DataSourceYear['cutoffs'][number]['group']

/** Problem with the rank lookup, built from the API's error envelope. */
export type RankError = {
  status: number
  code?: string
  message: string
  fields: Record<string, string>
}

export const PATH = '/neet-rank-predictor'

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'EWS', label: 'EWS' },
  { value: 'OBC', label: 'OBC (non-creamy layer)' },
  { value: 'SC', label: 'SC' },
  { value: 'ST', label: 'ST' },
]

export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

const GROUP_LABEL: Record<Group, string> = {
  OVERALL: 'All candidates',
  GENERAL: 'General',
  EWS: 'EWS',
  OBC: 'OBC',
  SC: 'SC',
  ST: 'ST',
  PWD: 'PwD',
}
export const groupLabel = (g: Group) => GROUP_LABEL[g] ?? g

const BASIS_LABEL: Record<Basis, string> = {
  EXACT_TIES: 'Exact score counts',
  BAND_INTERPOLATION: 'Estimated from mark ranges',
}
export const basisLabel = (b: Basis | null) => (b ? BASIS_LABEL[b] : 'No score counts published')

/** API integers arrive as string | number. */
export const num = (v: string | number) => Number(v)
export const fmt = (v: string | number) => formatNumber(num(v))

/** "10,800 – 12,400", or one number when both ends are the same. */
export function formatRange(r: RankRange): string {
  const [a, b] = [num(r.from), num(r.to)]
  return a === b ? formatNumber(a) : `${formatNumber(a)} – ${formatNumber(b)}`
}

/** Percentile as published, up to four decimals. */
export const formatPercentile = (p: number) => parseFloat(p.toFixed(4)).toString()

/** ISO date-time -> "18 Jul 2026" (date part only, so server and browser agree). */
export const checkedDate = (iso: string | null | undefined) => (iso ? formatDate(iso.slice(0, 10)) : NO_DATE)

/** Query string for a lookup, so every result has a shareable URL. */
export function rankHref(q: { score: string | number; category: string; pwd: boolean; year?: string | number }) {
  const p = new URLSearchParams({ score: String(q.score), category: q.category })
  if (q.pwd) p.set('pwd', '1')
  if (q.year !== undefined) p.set('year', String(q.year))
  return `${PATH}?${p}`
}

/** Client-side check before sending; the API stays the final check. */
export function isValidScore(v: string) {
  const t = v.trim()
  if (!/^-?\d+$/.test(t)) return false
  const s = Number(t)
  return s >= -180 && s <= 720
}
