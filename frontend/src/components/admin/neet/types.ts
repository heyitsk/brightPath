import type { paths } from '../../../api/schema'

type Ok<T> = T extends { responses: { 200: { content: { 'application/json': infer B } } } } ? B : never

export type YearList = Ok<paths['/admin/neet/years']['get']>
export type YearItem = YearList['items'][number]
/** GET /admin/neet/years/{year}: the year plus what the uploaded file holds and what blocks publishing. */
export type YearDetail = Ok<paths['/admin/neet/years/{year}']['get']>
export type ExamYear = YearDetail['examYear']
