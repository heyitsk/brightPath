import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * Typed API client for route loaders and actions (server only; the `.server`
 * suffix keeps it out of the browser bundle). Types come only from the
 * generated schema.d.ts; run `bun run gen:api` from the repo root after API changes.
 */
export const api = createClient<paths>({
  baseUrl: process.env.API_URL ?? 'http://localhost:4000',
})

/** The backend's standard error envelope (backendPlan §3.3). */
export type ApiErrorBody = {
  error: {
    code: string
    message: string
    fields?: { path: string; message: string }[]
    requestId: string
  }
}

/**
 * Unwraps an openapi-fetch result: returns `data`, or throws a Response that the
 * nearest route ErrorBoundary receives (status and the API's error code/message kept).
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data
  const body = result.error as Partial<ApiErrorBody> | undefined
  throw Response.json(
    {
      code: body?.error?.code ?? 'API_ERROR',
      message: body?.error?.message ?? 'The API returned an unexpected response.',
      requestId: body?.error?.requestId,
    },
    { status: result.response.status || 502 },
  )
}
