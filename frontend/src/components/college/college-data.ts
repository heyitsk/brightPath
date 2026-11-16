/*
  Small helpers over the college page data, safe for the browser bundle. data/colleges.ts calls
  the API through the server-only client, so components and route components import only its
  types and use these helpers at render time.
*/
import type { AbroadCollegePage, CollegePage, IndiaCollegePage } from '../../data/colleges'

type FeeLine = CollegePage['fees'][number]

export const isAbroad = (c: CollegePage): c is AbroadCollegePage => c.kind === 'ABROAD' && c.abroad !== null
export const isIndia = (c: CollegePage): c is IndiaCollegePage => c.kind === 'INDIA' && c.india !== null

/** Fee lines in year order. */
export const sortedFees = (fees: FeeLine[]) => [...fees].sort((a, b) => Number(a.yearNumber) - Number(b.yearNumber))

/** The newest check date among the fee lines. */
export const feesChecked = (fees: FeeLine[]) =>
  fees
    .map((l) => l.checkedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1) ?? null
