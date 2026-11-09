import { adminApi } from '../../../api/client.browser'
import { handleApiError, safeCall } from '../../../api/errors'
import { formatNumber } from '../../shared/format'
import { loadOrThrow } from '../crud/runtime'
import type { FieldDef, Opt } from '../crud/types'
import type { ExamYear, YearDetail } from './types'

/** Loads one year for the NEET screens; a bad or unknown year shows the backend's message. */
export async function loadYear(year: string | undefined): Promise<YearDetail> {
  if (!year || !/^\d+$/.test(year)) throw new Response('There is no such year.', { status: 404 })
  return loadOrThrow<YearDetail>(adminApi.GET('/admin/neet/years/{year}', { params: { path: { year } } }))
}

/** Official NTA documents, for the "source" choice. */
export async function loadSourceOptions(): Promise<Opt[]> {
  const result = await safeCall(adminApi.GET('/admin/sources', { params: { query: { kind: 'NTA', limit: 100 } } }))
  if (!('data' in result) || !result.data) {
    const failure = handleApiError(result)
    throw new Response(failure.formError, { status: failure.status || 503 })
  }
  return result.data.items.map((s) => ({ value: s.id, label: s.publisher ? `${s.title} (${s.publisher})` : s.title }))
}

export const num = (v: string | number | null | undefined) => (v == null ? '-' : formatNumber(Number(v)))

/** Fields of the year form. Names are the exact API field names. */
export const YEAR_FIELDS: FieldDef[] = [
  { name: 'year', label: 'Exam year', kind: 'number', required: true, fixedOnEdit: true },
  { name: 'appeared', label: 'Students who appeared', kind: 'number', required: true, min: 0 },
  { name: 'qualified', label: 'Students who qualified', kind: 'number', nullable: true, min: 0, hint: 'Leave empty if not published.' },
  { name: 'topperScore', label: 'Topper score', kind: 'number', nullable: true, hint: 'Leave empty if not published.' },
  {
    name: 'rankData',
    label: 'NTA published score counts for this year',
    kind: 'checkbox',
    defaultValue: true,
    hint: 'Untick only if NTA published totals and cut-offs but no score counts.',
  },
  { name: 'resultDate', label: 'Result date', kind: 'date', nullable: true },
  {
    name: 'sourceId',
    label: 'Source (official NTA document)',
    kind: 'select',
    required: true,
    lookup: 'sources',
    value: (r) => (r.source as ExamYear['source'] | undefined)?.id,
    hint: 'Add the document under Sources first if it is not in the list.',
  },
  { name: 'checkedAt', label: 'Date we checked the source', kind: 'date', required: true, defaultValue: 'today' },
  { name: 'methodNote', label: 'How this year was published', kind: 'textarea', nullable: true, hint: 'Shown on "Data we use".' },
]
