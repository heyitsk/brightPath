import { adminApi } from '../../../api/client.browser'
import { handleApiError, safeCall } from '../../../api/errors'
import { formatInr } from '../../shared/format'
import { loadOrThrow } from '../crud/runtime'
import type { Opt } from '../crud/types'
import type { College, Kind, Purpose, Status } from './types'

/** Throws so the section ErrorBoundary shows the problem (same as the other lookups). */
function fail(result: { error?: unknown; response: Response }): never {
  const failure = handleApiError(result)
  throw new Response(failure.formError, { status: failure.status || 503 })
}

export async function loadCollege(id: string | undefined): Promise<College> {
  if (!id) throw new Response('Not found.', { status: 404 })
  const data = await loadOrThrow<{ college: College }>(adminApi.GET('/admin/colleges/{id}', { params: { path: { id } } }))
  return data.college
}

export async function loadCountryOptions(): Promise<Opt[]> {
  const result = await safeCall(adminApi.GET('/admin/countries'))
  if (!('data' in result) || !result.data) fail(result)
  return result.data.items.map((c) => ({ value: c.id, label: c.name }))
}

export async function loadStateOptions(): Promise<Opt[]> {
  const result = await safeCall(adminApi.GET('/admin/states'))
  if (!('data' in result) || !result.data) fail(result)
  return result.data.items.map((s) => ({ value: s.id, label: s.name }))
}

/** Every source document (follows the pages), for the "link a source" choice. */
export async function loadSourceOptions(): Promise<Opt[]> {
  const out: Opt[] = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const result = await safeCall(adminApi.GET('/admin/sources', { params: { query: { limit: 100, cursor } } }))
    if (!('data' in result) || !result.data) fail(result)
    for (const s of result.data.items) out.push({ value: s.id, label: `${s.title} (${s.kind})` })
    if (!result.data.nextCursor) break
    cursor = result.data.nextCursor
  }
  return out
}

export const KIND_LABEL: Record<Kind, string> = { INDIA: 'India', ABROAD: 'Abroad' }
export const KIND_OPTIONS: Opt[] = [
  { value: 'INDIA', label: 'India' },
  { value: 'ABROAD', label: 'Abroad' },
]

export const STATUS_LABEL: Record<Status, string> = { DRAFT: 'Draft', READY: 'Ready', ARCHIVED: 'Archived' }
export const STATUS_OPTIONS: Opt[] = (Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))

export const OWNERSHIP_OPTIONS: Opt[] = [
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'PRIVATE', label: 'Private' },
  { value: 'DEEMED', label: 'Deemed university' },
  { value: 'TRUST', label: 'Trust' },
]

export const PURPOSE_LABEL: Record<Purpose, string> = {
  WDOMS: 'WDOMS listing',
  FEE_NOTICE: 'Fee notice',
  NMC_NOTICES: 'NMC notices',
  NMC_RECOGNITION: 'NMC recognition',
  SEAT_LIST: 'Seat list',
  COUNSELLING: 'Counselling',
  COLLEGE_WEBSITE: 'College website',
  OTHER: 'Other',
}
export const PURPOSE_OPTIONS: Opt[] = (Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => ({
  value: p,
  label: PURPOSE_LABEL[p],
}))

export const LOCATION_BASIS_LABEL: Record<string, string> = {
  WELL_KNOWN: 'Well known',
  IN_COLLEGE_NAME: 'In the college name',
  CHECKED_ONLINE: 'Checked online',
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Whole numbers come as string | number: always Number() before maths or formatting. */
export const num = (v: string | number | null | undefined): number | null => (v == null || v === '' ? null : Number(v))

export function inr(v: string | number | null | undefined): string {
  const n = num(v)
  return n == null ? 'Not available yet' : formatInr(n)
}

/** "x of y" fee years; y is unknown until the course length is set. */
export function feeYears(r: { feeYearsFilled: string | number; feeYearsRequired: string | number | null }) {
  const need = num(r.feeYearsRequired)
  return `${num(r.feeYearsFilled) ?? 0} of ${need ?? '?'}`
}
