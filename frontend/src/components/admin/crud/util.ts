import { formatDate } from '../../shared/format'

export const today = () => new Date().toISOString().slice(0, 10)

/** API date or date-time -> "12 Oct 2026". */
export function showDate(value: unknown): string {
  return typeof value === 'string' && value.length >= 10 ? formatDate(value.slice(0, 10)) : '-'
}
