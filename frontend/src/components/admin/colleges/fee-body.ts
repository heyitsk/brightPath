import { today } from '../crud/util'
import type { College } from './types'

export type ServerFee = College['fees'][number]
export type FeeBody = { tuition: number; hostel: number; other: number; currency: string; sourceId: string | null; checkedAt: string }

/** The inputs of one fee row, as text, exactly as staff typed them. */
export type FeeDraft = {
  year: string
  tuition: string
  hostel: string
  other: string
  currency: string
  sourceId: string
  checkedAt: string
  /** The year already had a row when the page loaded (its year cannot be changed). */
  saved: boolean
  /** Marked for deletion (saved rows only). */
  removed: boolean
}

export const FEE_FIELDS = ['year', 'tuition', 'hostel', 'other', 'currency', 'sourceId', 'checkedAt'] as const
export type FeeField = (typeof FEE_FIELDS)[number]
/** `row` holds an error that belongs to the row as a whole (e.g. the server could not be reached). */
export type FeeErrors = Partial<Record<FeeField | 'row', string>>

/** A row the last save did not get through, with why; the editor puts it back on screen. */
export type FailedFee = FeeDraft & { errors: FeeErrors; refused?: boolean }

/** A live college refused a change because it would lose a required detail (D-094). */
export type FeeRefusal = { year: number; removing: boolean; message: string; reasons: string[] }

export const MAX_FEE_YEARS = 12

const amount = (v: number) => String(v)

export function draftFromServer(f: ServerFee): FeeDraft {
  return {
    year: String(f.yearNumber),
    tuition: amount(f.tuition),
    hostel: amount(f.hostel),
    other: amount(f.other),
    currency: f.currency,
    sourceId: f.source?.id ?? '',
    checkedAt: f.checkedAt ? f.checkedAt.slice(0, 10) : '',
    saved: true,
    removed: false,
  }
}

/** Rows posted as `fee.{i}.{field}` plus `feeCount`. */
export function readFeeRows(form: FormData): FeeDraft[] {
  const count = Math.min(Number(form.get('feeCount') ?? 0) || 0, MAX_FEE_YEARS * 2)
  const text = (i: number, f: string) => String(form.get(`fee.${i}.${f}`) ?? '').trim()
  const rows: FeeDraft[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      year: text(i, 'year'),
      tuition: text(i, 'tuition'),
      hostel: text(i, 'hostel'),
      other: text(i, 'other'),
      currency: text(i, 'currency').toUpperCase(),
      sourceId: text(i, 'sourceId'),
      checkedAt: text(i, 'checkedAt'),
      saved: text(i, 'saved') === '1',
      removed: text(i, 'removed') === '1',
    })
  }
  return rows
}

const twoDecimals = /^\d+(\.\d{1,2})?$/

function money(raw: string, required: boolean): string | undefined {
  if (raw === '') return required ? 'Enter the amount (0 is allowed).' : undefined
  if (!twoDecimals.test(raw)) return 'Use a number of 0 or more, with at most 2 decimal places.'
  return undefined
}

/** Checks done before any call, so obvious mistakes never reach the API. One entry per row (same order). */
export function validateFeeRows(rows: FeeDraft[]): FeeErrors[] {
  return rows.map((r, i) => {
    const e: FeeErrors = {}
    if (r.removed) return e
    const year = Number(r.year)
    // A new row clashes with any saved row of that year (even one being removed) or an earlier new row.
    const clash = rows.some((o, j) => j !== i && o.year === r.year && (o.saved ? !r.saved : !o.removed && j < i))
    if (!/^\d+$/.test(r.year) || year < 1 || year > MAX_FEE_YEARS) e.year = `Enter a year from 1 to ${MAX_FEE_YEARS}.`
    else if (clash)
      e.year = rows.some((o) => o.saved && o.removed && o.year === r.year)
        ? `Year ${year} is being removed. Undo the removal and edit that row instead.`
        : `Year ${year} is already in the table.`
    const t = money(r.tuition, true)
    if (t) e.tuition = t
    const h = money(r.hostel, false)
    if (h) e.hostel = h
    const o = money(r.other, false)
    if (o) e.other = o
    if (!/^[A-Z]{3}$/.test(r.currency)) e.currency = 'Use a 3-letter code such as USD, RUB or INR.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checkedAt)) e.checkedAt = 'Enter the date the figures were checked.'
    else if (r.checkedAt > today()) e.checkedAt = 'The date cannot be in the future.'
    return e
  })
}

export function bodyOf(r: FeeDraft): FeeBody {
  return {
    tuition: Number(r.tuition),
    hostel: r.hostel === '' ? 0 : Number(r.hostel),
    other: r.other === '' ? 0 : Number(r.other),
    currency: r.currency.toUpperCase(),
    sourceId: r.sourceId || null,
    checkedAt: r.checkedAt,
  }
}

/** True when a row differs from what the server holds for that year (or the year has no row yet). */
export function isChanged(r: FeeDraft, server: ServerFee | undefined): boolean {
  if (r.removed) return Boolean(server)
  if (!server) return true
  const a = bodyOf(r)
  const b = bodyOf(draftFromServer(server))
  return (
    a.tuition !== b.tuition ||
    a.hostel !== b.hostel ||
    a.other !== b.other ||
    a.currency !== b.currency ||
    a.sourceId !== b.sourceId ||
    a.checkedAt !== b.checkedAt
  )
}

export const serverFee = (fees: ServerFee[], year: string | number) => fees.find((f) => String(f.yearNumber) === String(year))

/** What to send: a PUT per new or changed year, a DELETE per removed year that still exists. Indexes point into `rows`. */
export function planFeeChanges(rows: FeeDraft[], fees: ServerFee[]) {
  const puts: number[] = []
  const deletes: number[] = []
  rows.forEach((r, i) => {
    const server = serverFee(fees, r.year)
    if (r.removed) {
      if (r.saved && server) deletes.push(i)
    } else if (isChanged(r, server)) puts.push(i)
  })
  return { puts, deletes }
}

type ErrorFields = { path: string; message: string }[]

/**
 * A 422 for one fee year: either ordinary field errors for that row, or (when any path is not a fee
 * field, e.g. `fees.3.sourceId`) a live college refusing to lose a required detail (D-094).
 */
export function sortFeeError(message: string, fields: ErrorFields | undefined): { errors: FeeErrors } | { refusal: { message: string; reasons: string[] } } {
  const list = (fields ?? []).map((f) => ({ ...f, path: f.path.replace(/^\//, '') }))
  const rowOnly = list.length > 0 && list.every((f) => (FEE_FIELDS as readonly string[]).includes(f.path))
  if (rowOnly) {
    const errors: FeeErrors = {}
    for (const f of list) errors[f.path as FeeField] ??= f.message
    return { errors }
  }
  return { refusal: { message, reasons: list.map((f) => f.message) } }
}
