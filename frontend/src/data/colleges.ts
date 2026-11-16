/*
  College data from the public colleges API (backend phase 4e, history.md D-115 to D-123).
  GET /colleges/{slug} is the college page; GET /colleges/ is the directory (cards + facets),
  used by the country and state pages and the menus. Types come only from schema.d.ts.
  Server only (it uses api/client.server.ts): components import its types, and the browser-safe
  helpers (isAbroad, isIndia…) live in components/college/college-data.ts.
*/
import { api, unwrap } from '../api/client.server'
import type { paths } from '../api/schema'

type PageResponse = paths['/colleges/{slug}']['get']['responses'][200]['content']['application/json']
type ListOperation = paths['/colleges/']['get']
type ListResponse = ListOperation['responses'][200]['content']['application/json']

/** Everything a college page shows. */
export type CollegePage = PageResponse['college']
/** One college card (directory, nearby colleges, country and state lists, menus). */
export type CollegeCard = ListResponse['items'][number]
export type CollegeList = ListResponse
export type CollegeListQuery = NonNullable<ListOperation['parameters']['query']>

export type AbroadCollegePage = CollegePage & { kind: 'ABROAD'; abroad: NonNullable<CollegePage['abroad']> }
export type IndiaCollegePage = CollegePage & { kind: 'INDIA'; india: NonNullable<CollegePage['india']> }

/** The college page. null for an unknown or unlisted slug (the API answers 404), which the route shows as the 404 page. */
export async function getCollege(slug: string): Promise<CollegePage | null> {
  const result = await api.GET('/colleges/{slug}', { params: { path: { slug } } })
  if (result.response.status === 404) return null
  return unwrap(result).college
}

/** Listed colleges matching the filters, up to 50 (the API's page size limit). */
export async function listColleges(query: CollegeListQuery = {}): Promise<CollegeList> {
  return unwrap(await api.GET('/colleges/', { params: { query: { pageSize: 50, ...query } } }))
}
