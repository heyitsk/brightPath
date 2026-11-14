import type { paths } from '../../../api/schema'

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never

export type BatchList = Json<paths['/admin/imports']['get']['responses'][200]>
export type Batch = BatchList['items'][number]
export type Detail = Json<paths['/admin/imports/{id}']['get']['responses'][200]>
export type Preview = NonNullable<Detail['preview']>
export type PreviewItem = Preview['items'][number]
export type SkippedRow = Detail['errors'][number]
export type Committed = Json<paths['/admin/imports/{id}/commit']['post']['responses'][200]>
export type Counts = Preview['counts']
export type Action = PreviewItem['action']
export type UploadKind = paths['/admin/imports/templates/{kind}']['get']['parameters']['path']['kind']
