import type { FieldDef, Row } from './types'
import { today } from './util'

/** Starting value of a field: from the record when editing, else its default. */
export function initialValue(f: FieldDef, row?: Row): string | boolean {
  if (row) {
    const raw = f.value ? f.value(row) : row[f.name]
    if (f.kind === 'checkbox') return Boolean(raw)
    if (f.kind === 'tags') return Array.isArray(raw) ? raw.join(', ') : ''
    if (f.kind === 'date') return typeof raw === 'string' ? raw.slice(0, 10) : ''
    return raw == null ? '' : String(raw)
  }
  if (f.kind === 'checkbox') return f.defaultValue === true
  if (f.kind === 'date' && f.defaultValue === 'today') return today()
  return typeof f.defaultValue === 'string' ? f.defaultValue : ''
}

function parse(f: FieldDef, form: FormData): string | boolean | string[] {
  if (f.kind === 'checkbox') return form.get(f.name) === 'on'
  const raw = String(form.get(f.name) ?? '').trim()
  if (f.kind === 'tags') {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return raw
}

/**
 * Builds the request body from a submitted form. On create, empty optional fields are left out.
 * On edit (PATCH), only fields that changed are sent, and a cleared nullable field becomes null.
 */
export function buildBody(fields: FieldDef[], form: FormData, original?: Row): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const f of fields) {
    if (original && f.fixedOnEdit) continue
    const value = parse(f, form)
    if (original) {
      const before = initialValue(f, original)
      const now = Array.isArray(value) ? value.join(', ') : value
      if (now === before) continue
    }
    if (typeof value === 'boolean' || Array.isArray(value)) body[f.name] = value
    else if (value === '') {
      if (original && f.nullable) body[f.name] = null
    } else body[f.name] = f.kind === 'number' ? Number(value) : value
  }
  return body
}
