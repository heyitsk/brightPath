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
