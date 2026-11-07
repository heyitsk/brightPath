import { redirect } from 'react-router'
import type { components } from './schema'

type ApiErrorBody = components['schemas']['ErrorEnvelope']

/** What a form needs to show after a failed API call. */
export type ApiFailure = {
  status: number
  code?: string
  formError: string
  fieldErrors: Record<string, string>
}

type ApiResult = { error?: unknown; response: Response }

/** Runs an API call; a network failure becomes a status-0 result instead of a thrown TypeError. */
export async function safeCall<T extends ApiResult>(call: Promise<T>): Promise<T | ApiResult> {
  try {
    return await call
  } catch {
    return { error: undefined, response: new Response(null, { status: 0 }) }
  }
}

/**
 * Turns a failed API result into something a form can show, or redirects:
 * 401 → /admin/login (unless `keep401`, e.g. the login form itself), 403 PASSWORD_CHANGE_REQUIRED
 * → /admin/change-password, other 403 → "not allowed", 422 → per-field messages.
 * Throws a redirect Response, so call it from a clientLoader/clientAction.
 */
export function handleApiError(result: ApiResult, opts: { keep401?: boolean } = {}): ApiFailure {
  const { status } = result.response
  const body = (result.error as Partial<ApiErrorBody> | undefined)?.error
  const message = body?.message
  const code = body?.code

  if (status === 401 && !opts.keep401) throw redirect('/admin/login')
  if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') throw redirect('/admin/change-password')

  const fieldErrors: Record<string, string> = {}
  for (const f of body?.fields ?? []) fieldErrors[f.path] ??= f.message

  let formError = message ?? 'Something went wrong. Please try again.'
  if (status === 0) formError = 'Could not reach the server. Check your connection and try again.'
  else if (status === 403) formError = 'You are not allowed to do that.'
  else if (status === 422) formError = message ?? 'Please fix the highlighted fields.'
  else if (status >= 500) formError = 'The server had a problem. Please try again in a moment.'

  return { status, code, formError, fieldErrors }
}
