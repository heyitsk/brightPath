const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-12" -> "12 Oct 2026". Plain string work, so server and browser always agree. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Shown wherever a "checked on" date is missing, so the gap is visible. */
export const NO_DATE = 'date not recorded'

export function checkedOn(iso: string | null): string {
  return iso ? `checked ${formatDate(iso)}` : NO_DATE
}

/** Indian digit grouping: 3160000 -> "31,60,000". */
function groupIndian(n: number): string {
  const s = Math.round(Math.abs(n)).toString()
  if (s.length <= 3) return s
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${head},${s.slice(-3)}`
}

export const NBSP = '\u00a0'

/** "₹ 5,25,000" with a non-breaking space. */
export function formatInr(n: number): string {
  return `₹${NBSP}${groupIndian(n)}`
}

/** "₹ 31.6 lakh" for headline totals. */
export function formatLakh(n: number): string {
  const lakh = Math.round((n / 100_000) * 10) / 10
  return `₹${NBSP}${lakh} lakh`
}

/** "[number]" style slot for a fact we do not have yet. */
export const slot = (label: string) => `[${label}]`

const CURRENCY_NAMES: Record<string, string> = {
  RUB: 'rouble',
  GEL: 'lari',
  KZT: 'tenge',
  KGS: 'som',
  UZS: 'sum',
  USD: 'US dollar',
  EUR: 'euro',
}

export const currencyName = (code: string) => CURRENCY_NAMES[code] ?? code

export function courseLength(months: number): string {
  if (months % 12 === 0) return `${months / 12} years`
  return `${months} months`
}

/** "₹1.05" for an exchange rate: at least two decimals, up to four. */
export function formatRate(rate: number): string {
  const trimmed = parseFloat(rate.toFixed(4)).toString()
  const decimals = trimmed.split('.')[1]?.length ?? 0
  return `₹${decimals >= 2 ? trimmed : rate.toFixed(2)}`
}
