export type SettingKind = 'text' | 'number' | 'boolean' | 'list'

/** Which input fits a setting, judged from its default/current value (the API sends no type). */
export function kindOf(value: unknown, fallback: unknown): SettingKind {
  for (const v of [value, fallback]) {
    if (typeof v === 'number') return 'number'
    if (typeof v === 'boolean') return 'boolean'
    if (Array.isArray(v)) return 'list'
  }
  return 'text'
}

/** Short, readable form of a stored value for the table. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not set'
  if (Array.isArray(v)) return v.length === 0 ? 'Empty list' : v.join(', ')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/** Form text -> the JSON value the API expects, or an error message. */
export function parseValue(kind: SettingKind, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim()
  if (kind === 'number') {
    if (text === '' || !Number.isFinite(Number(text))) return { error: 'Enter a number.' }
    return { value: Number(text) }
  }
  if (kind === 'boolean') return { value: text === 'true' }
  if (kind === 'list') {
    return { value: text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) }
  }
  return { value: text === '' ? null : text }
}
