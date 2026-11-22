import type { paths } from '../../../api/schema'

type Json<T> = T extends { content: { 'application/json': infer J } } ? J : never

export type NewsList = Json<paths['/admin/news/items']['get']['responses'][200]>
export type NewsListItem = NewsList['items'][number]
export type NewsItem = Json<paths['/admin/news/items/{id}']['get']['responses'][200]>['item']
export type NewsStatus = NewsItem['status']
export type NewsCategory = NewsItem['category']
export type NewsQuery = NonNullable<paths['/admin/news/items']['get']['parameters']['query']>
export type ItemBody = NonNullable<
  paths['/admin/news/items/{id}']['patch']['requestBody']
>['content']['application/json']
export type BulkAction = NonNullable<
  paths['/admin/news/items/bulk']['post']['requestBody']
>['content']['application/json']['action']
export type BulkResult = Json<paths['/admin/news/items/bulk']['post']['responses'][200]>

// News sources (EDITOR and ADMIN).
export type SourceList = Json<paths['/admin/news/sources']['get']['responses'][200]>
export type NewsSource = Json<paths['/admin/news/sources/{id}']['get']['responses'][200]>['source']
export type SourceKind = NewsSource['kind']
export type SourceHealth = NewsSource['status']
export type SourceBody = NonNullable<
  paths['/admin/news/sources']['post']['requestBody']
>['content']['application/json']
export type SourcePatch = NonNullable<
  paths['/admin/news/sources/{id}']['patch']['requestBody']
>['content']['application/json']
export type TestResult = Json<paths['/admin/news/sources/{id}/test']['post']['responses'][200]>
export type TestItem = TestResult['items'][number]
export type SourceRuns = Json<paths['/admin/news/sources/{id}/runs']['get']['responses'][200]>
export type SourceRun = SourceRuns['items'][number]
export type RunOutcome = SourceRun['outcome']
export type RelevanceResult = Json<paths['/admin/news/relevance/test']['post']['responses'][200]>
export type RescoreResult = Json<paths['/admin/news/rescore']['post']['responses'][200]>
export type NewsStats = Json<paths['/admin/news/stats']['get']['responses'][200]>
