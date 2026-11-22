/*
  Published news notices from the public news API (backendPlan §15.7): GET /news/ is the list
  (cards + facets, pinned first then newest), GET /news/{slug} is one notice. Types come only from
  schema.d.ts. Server only (it uses api/client.server.ts): components import its types, and the
  wording helpers live in components/shared/news.ts.
*/
import { api, unwrap } from '../api/client.server'
import { safeCall } from '../api/errors'
import type { paths } from '../api/schema'

type ListOperation = paths['/news/']['get']
type PageResponse = paths['/news/{slug}']['get']['responses'][200]['content']['application/json']

export type NewsList = ListOperation['responses'][200]['content']['application/json']
/** One notice card on the News page and the home page. */
export type NewsCard = NewsList['items'][number]
export type NewsListQuery = NonNullable<ListOperation['parameters']['query']>
/** Everything the notice page shows. */
export type NewsPage = PageResponse['news']

/** Published notices matching the filters. Errors go to the route ErrorBoundary. */
export async function listNews(query: NewsListQuery = {}): Promise<NewsList> {
  return unwrap(await api.GET('/news/', { params: { query } }))
}

/** One notice. null for an unknown or taken-down slug (the API answers 404), shown as the 404 page. */
export async function getNews(slug: string): Promise<NewsPage | null> {
  const result = await api.GET('/news/{slug}', { params: { path: { slug } } })
  if (result.response.status === 404) return null
  return unwrap(result).news
}

/** The newest three notices for the home page. Never throws: any failure gives an empty list. */
export async function latestNews(): Promise<NewsCard[]> {
  const result = await safeCall(api.GET('/news/', { params: { query: { pageSize: 3 } } }))
  return 'data' in result && result.data ? result.data.items : []
}
