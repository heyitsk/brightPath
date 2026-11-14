import type { paths } from '../../../api/schema'
import { today } from '../crud/util'

type List = paths['/admin/fx-rates']['get']['responses'][200]['content']['application/json']
export type FxList = List
export type FxItem = List['items'][number]
export type RateBody = paths['/admin/fx-rates']['put']['requestBody']['content']['application/json']['items'][number]
/** What every save and delete answers: colleges using the currency, and rupee totals that changed. */
export type Effect = { collegesUsing: string | number; collegesRecalculated: string | number }

/** Row key of the "Add currency" row (real rows use their 3-letter code, so it never clashes). */
export const NEW = 'new'

/** A row as typed. Field names match the API so errors line up with inputs. */
export type Draft = { currency: string; rateToInr: string; asOf: string; sourceNote: string }
export type DraftField = keyof Draft
export type RowErrors = Partial<Record<DraftField | 'row', string>>
export type LargeChange = { currency: string; old: number; next: number }

export type FxDone = { ok: true; message: string; at: number }
export type FxFailed = {
  ok: false
  formError?: string
  rowErrors: Record<string, RowErrors>
  /** Rows the API refused for changing by more than 20% (D-104); staff may confirm them. */
  large: LargeChange[]
  /** The intent that resends the same request with confirmLargeChange. */
  confirmIntent?: string
  at: number
}

/** Matches the API's guard (D-104). Only used to recognise its refusal; the API stays the judge. */
const LARGE_CHANGE_SHARE = 0.2
const FIELDS: DraftField[] = ['currency', 'rateToInr', 'asOf', 'sourceNote']

/** Rows for the page: never INR; currencies with no rate first, then A to Z. */
export function listOf(data: FxList): FxItem[] {
  return data.items
    .filter((i) => i.currency.toUpperCase() !== 'INR')
    .sort((a, b) => Number(a.hasRate) - Number(b.hasRate) || a.currency.localeCompare(b.currency))
}

export function draftFrom(item: FxItem): Draft {
  return {
    currency: item.currency,
    rateToInr: item.rateToInr == null ? '' : String(item.rateToInr),
    asOf: item.asOf ? item.asOf.slice(0, 10) : '',
    sourceNote: item.sourceNote ?? '',
  }
}

export const emptyDraft = (): Draft => ({ currency: '', rateToInr: '', asOf: today(), sourceNote: '' })

/** Whether the row differs from what is stored. Without a stored row (Add currency), whether anything was typed. */
export function isChanged(d: Draft, item?: FxItem): boolean {
  if (!item) return d.currency.trim() !== '' || d.rateToInr.trim() !== '' || d.sourceNote.trim() !== ''
  if (!item.hasRate) return d.rateToInr.trim() !== '' || d.sourceNote.trim() !== ''
  return (
    d.rateToInr.trim() === '' ||
    Number(d.rateToInr) !== Number(item.rateToInr) ||
    d.asOf !== (item.asOf ?? '').slice(0, 10) ||
    d.sourceNote.trim() !== (item.sourceNote ?? '').trim()
  )
}

export const isLarge = (old: number | null, next: number) =>
  old != null && old > 0 && Math.abs(next - old) / old > LARGE_CHANGE_SHARE

const sixDecimals = (v: number) => Math.abs(Math.round(v * 1e6) / 1e6 - v) < 1e-9

/** Quick checks before anything is sent. The API repeats them and checks the rest. */
export function checkDraft(d: Draft, isNew: boolean, listed: Set<string>): RowErrors {
  const errors: RowErrors = {}
  if (isNew) {
    const code = d.currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) errors.currency = 'Use a 3-letter currency code such as USD.'
    else if (code === 'INR') errors.currency = 'INR is always 1, so it has no exchange rate.'
    else if (listed.has(code)) errors.currency = `${code} is already in the list. Change its row instead.`
  }
  const rate = Number(d.rateToInr)
  if (d.rateToInr.trim() === '' || !Number.isFinite(rate) || rate <= 0) {
    errors.rateToInr = 'Enter how many rupees one unit buys, for example 88.5.'
  } else if (!sixDecimals(rate)) errors.rateToInr = 'Use at most 6 decimal places.'
  if (!d.asOf) errors.asOf = 'Enter the date the rate was read.'
  else if (d.asOf > today()) errors.asOf = 'The date cannot be in the future.'
  return errors
}

export function bodyOf(d: Draft): RateBody {
  return {
    currency: d.currency.trim().toUpperCase(),
    rateToInr: Number(d.rateToInr),
    asOf: d.asOf,
    sourceNote: d.sourceNote.trim() || null,
  }
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '')

function draftAt(form: FormData, prefix: string): Draft {
  return {
    currency: text(form, `${prefix}.currency`).trim().toUpperCase(),
    rateToInr: text(form, `${prefix}.rateToInr`).trim(),
    asOf: text(form, `${prefix}.asOf`),
    sourceNote: text(form, `${prefix}.sourceNote`),
  }
}

/** Every row on the page as typed (`fx.N.*`) plus the Add currency row (`new.*`). */
export function readForm(form: FormData): { rows: Draft[]; added: Draft } {
  const count = Number(form.get('count') ?? 0)
  const rows: Draft[] = []
  for (let i = 0; i < count; i++) rows.push(draftAt(form, `fx.${i}`))
  return { rows, added: draftAt(form, NEW) }
}

/** `USD=885;EUR=120`: the rates a "more than 20%" prompt was shown for. */
export function readConfirmed(value: FormDataEntryValue | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const pair of String(value ?? '').split(';')) {
    const [code, rate] = pair.split('=')
    if (code && rate) out.set(code, Number(rate))
  }
  return out
}

export const errorFields = (error: unknown) =>
  (error as { error?: { fields?: { path: string; message: string }[] } } | undefined)?.error?.fields

/**
 * Puts each API field error under its row. `items.N.field` names the N-th row *sent*; with one row
 * sent the API uses the bare field name. Anything that names no row comes back in `rest`.
 */
export function mapErrors(fields: { path: string; message: string }[] | undefined, keys: string[]) {
  const rows: Record<string, RowErrors> = {}
  const rest: string[] = []
  for (const f of fields ?? []) {
    const path = f.path.replace(/^\//, '').replace(/\//g, '.')
    const m = /^items\.(\d+)\.(.+)$/.exec(path)
    const key = m ? keys[Number(m[1])] : keys.length === 1 ? keys[0] : undefined
    if (!key) {
      rest.push(f.message)
      continue
    }
    const name = m ? m[2] : path
    const field = FIELDS.find((x) => x === name) ?? 'row'
    const row = (rows[key] ??= {})
    row[field] = row[field] ? `${row[field]} ${f.message}` : f.message
  }
  return { rows, rest }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const listNames = (codes: string[]) => (codes.length === 1 ? codes[0] : 'these currencies')

/** The API's answer after a save, in plain words. `knownUsing`: colleges the page showed for these currencies. */
export function savedText(codes: string[], e: Effect, knownUsing: number): string {
  const head = codes.length === 1 ? `${codes[0]} rate saved.` : `${codes.length} rates saved (${codes.join(', ')}).`
  const n = Number(e.collegesUsing)
  const m = Number(e.collegesRecalculated)
  if (n === 0) {
    return knownUsing > 0
      ? `${head} The rate itself did not change, so no prices changed.`
      : `${head} No college charges fees in ${listNames(codes)} yet, so no prices changed.`
  }
  return `${head} ${count(n, 'college charges', 'colleges charge')} fees in ${listNames(codes)}; ${
    m === 0 ? 'no rupee totals' : count(m, 'rupee total', 'rupee totals')
  } changed.`
}

export function removedText(code: string, e: Effect): string {
  const n = Number(e.collegesUsing)
  const m = Number(e.collegesRecalculated)
  if (n === 0) return `${code} rate removed. No college charges fees in ${code}, so no prices changed.`
  return `${code} rate removed. ${count(n, 'college charges', 'colleges charge')} fees in ${code}; ${
    m === 0 ? 'no rupee totals' : count(m, 'rupee total', 'rupee totals')
  } changed. They show no rupee total until a ${code} rate is set again.`
}

export const showRate = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 6 })
