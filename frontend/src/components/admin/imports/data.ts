import { adminApi } from '../../../api/client.browser'
import { handleApiError, safeCall, type ApiFailure } from '../../../api/errors'
import type { Action, Batch, Counts, UploadKind } from './types'

/** Whole numbers arrive as string | number. */
export const n = (v: string | number | null | undefined) => Number(v ?? 0)

export const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export const KINDS: { value: UploadKind; label: string; hint: string }[] = [
  {
    value: 'COLLEGES',
    label: 'Colleges',
    hint: 'A list of colleges in India or abroad. New colleges start as drafts; stored details are never overwritten.',
  },
  {
    value: 'FEES',
    label: 'Fees',
    hint: 'One row per college per course year. A fee row replaces the stored fee for that year.',
  },
]

export const KIND_LABEL: Record<Batch['kind'], string> = { COLLEGES: 'Colleges', FEES: 'Fees', MOCK_SAMPLE: 'Sample' }

export const STATUS_LABEL: Record<Batch['status'], string> = {
  UPLOADED: 'Uploaded',
  VALIDATED: 'Waiting to save',
  COMMITTED: 'Saved',
  FAILED: 'Failed',
}

export const ACTION_LABEL: Record<Action, string> = {
  CREATE: 'New',
  UPDATE: 'Updated',
  UNCHANGED: 'Unchanged',
  SKIP: 'Skipped',
  ERROR: 'Error',
}

/** What saving wrote, by the keys the API uses. */
export const RESULT_LABEL: Record<string, string> = {
  created: 'New',
  updated: 'Updated',
  colleges: 'Colleges re-priced',
  sourcesCreated: 'Sources added',
}

export type Show = 'all' | 'errors' | 'warnings' | 'changes'
export const SHOWS: { key: Show; label: string; action?: Action }[] = [
  { key: 'all', label: 'All rows' },
  { key: 'errors', label: 'Errors', action: 'ERROR' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'changes', label: 'Changes', action: 'UPDATE' },
]
export const parseShow = (v: string | null): Show => SHOWS.find((s) => s.key === v)?.key ?? 'all'

/** One line summary of row counts, e.g. "3 new · 1 updated · 2 errors". */
export function countsLine(c: Counts | null): string {
  if (!c) return '—'
  const parts = [
    [n(c.CREATE), 'new'],
    [n(c.UPDATE), 'updated'],
    [n(c.UNCHANGED), 'unchanged'],
    [n(c.SKIP), 'skipped'],
    [n(c.ERROR), n(c.ERROR) === 1 ? 'error' : 'errors'],
  ] as const
  const shown = parts.filter(([v]) => v > 0).map(([v, l]) => `${v} ${l}`)
  return shown.length > 0 ? shown.join(' · ') : 'No rows'
}

/** "You" for the signed-in staff member, else the uploader's name from the API. */
export function whoLabel(batch: Pick<Batch, 'createdById' | 'createdByName'>, meId: string | undefined): string {
  if (batch.createdById && batch.createdById === meId) return 'You'
  return batch.createdByName ?? 'Unknown'
}

export const PAGE = 100

/** Fetches a CSV template with the session cookie and saves it as a file. Throws a redirect on 401. */
export async function downloadTemplate(kind: UploadKind): Promise<ApiFailure | null> {
  const result = await safeCall(
    adminApi.GET('/admin/imports/templates/{kind}', { params: { path: { kind } }, parseAs: 'blob' }),
  )
  const blob = (result as { data?: unknown }).data
  if (!result.response.ok || !(blob instanceof Blob)) return handleApiError(result)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${kind.toLowerCase()}-template.csv`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return null
}
