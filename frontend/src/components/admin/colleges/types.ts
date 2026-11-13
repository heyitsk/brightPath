import type { paths } from '../../../api/schema'

type Ok<T> = T extends { responses: { 200: { content: { 'application/json': infer B } } } } ? B : never
type Body<T> = T extends { requestBody: { content: { 'application/json': infer B } } } ? B : never

export type CollegeList = Ok<paths['/admin/colleges']['get']>
export type CollegeListItem = CollegeList['items'][number]
/** Everything about one college, as GET /admin/colleges/{id} returns it. */
export type College = Ok<paths['/admin/colleges/{id}']['get']>['college']
export type Kind = College['kind']
export type Status = College['status']
export type Purpose = College['sources'][number]['purpose']

export type Create = Body<paths['/admin/colleges']['post']>
export type Update = Body<paths['/admin/colleges/{id}']['patch']>
export type SourceLinkCreate = Body<paths['/admin/colleges/{id}/sources']['post']>
export type SourceLinkUpdate = Body<paths['/admin/colleges/{id}/sources/{linkId}']['patch']>
export type FaqBody = Body<paths['/admin/colleges/{id}/faqs']['put']>
