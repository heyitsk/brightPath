import { buildBody } from '../crud/form-data'
import type { Row } from '../crud/types'
import { allFields, INTAKE, TRI_STATE } from './fields'
import type { College, Update } from './types'

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Month numbers ticked in the form, sorted. */
export const tickedMonths = (form: FormData) =>
  [...new Set(form.getAll(INTAKE).map(Number))].filter((n) => n >= 1 && n <= 12).sort((a, b) => a - b)

/**
 * PATCH body for the college form: only fields that changed. Field names like `india.mbbsSeats`
 * become `{ india: { mbbsSeats } }`, three-way answers become true / false / null, and the
 * eligibility and documents text become the object and list the API expects.
 */
export function buildCollegeBody(college: College, form: FormData): { body: Update; fieldErrors: Record<string, string> } {
  const fields = allFields(college.kind).map((f) =>
    // Clearing the documents list must still be sent (as an empty list), so treat it as nullable here.
    f.name === 'abroad.documents' ? { ...f, nullable: true } : f,
  )
  const flat = buildBody(fields, form, college as unknown as Row)
  const fieldErrors: Record<string, string> = {}

  if (college.kind === 'ABROAD') {
    const before = (college.abroad?.intakeMonths ?? []).map(Number).sort((a, b) => a - b)
    const now = tickedMonths(form)
    if (before.join(',') !== now.join(',')) flat[INTAKE] = now
  }

  const body: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(flat)) {
    let value = raw
    if (TRI_STATE.has(key)) value = raw === null ? null : raw === 'true'
    else if (key === 'abroad.documents') value = raw === null ? [] : lines(String(raw))
    else if (key === 'abroad.eligibility' && raw !== null) {
      const rules: Record<string, string> = {}
      for (const line of lines(String(raw))) {
        const at = line.indexOf(':')
        if (at < 1 || at === line.length - 1) {
          fieldErrors[key] = `"${line}" needs a label, a colon and the rule, e.g. "Age: 17 by 31 December".`
          break
        }
        rules[line.slice(0, at).trim()] = line.slice(at + 1).trim()
      }
      value = Object.keys(rules).length > 0 ? rules : null
    }

    const dot = key.indexOf('.')
    if (dot === -1) body[key] = value
    else {
      const group = key.slice(0, dot)
      body[group] = { ...(body[group] as Record<string, unknown> | undefined), [key.slice(dot + 1)]: value }
    }
  }
  return { body: body as Update, fieldErrors }
}

/** Rebuilds the FAQ list from the form, in order. */
export function readFaqs(form: FormData): { question: string; answer: string }[] {
  const count = Number(form.get('faqCount') ?? 0)
  const items: { question: string; answer: string }[] = []
  for (let i = 0; i < count; i++) {
    items.push({
      question: String(form.get(`faq.${i}.question`) ?? '').trim(),
      answer: String(form.get(`faq.${i}.answer`) ?? '').trim(),
    })
  }
  return items
}
