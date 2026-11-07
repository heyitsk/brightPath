import { redirect } from 'react-router'
import { handleApiError, safeCall } from '../../../api/errors'
import { REGISTRY } from './registry'
import type { ApiCall, Opt, ResourceConfig, Row } from './types'

/** The config for /admin/:section, or a 404 for anything unknown. */
export function getResource(section: string | undefined): ResourceConfig {
  const cfg = section ? REGISTRY[section] : undefined
  if (!cfg) throw new Response('There is no such admin section.', { status: 404 })
  return cfg
}

/** For loaders: returns the response data, or throws so the section ErrorBoundary shows the problem. */
export async function loadOrThrow<T>(call: ApiCall): Promise<T> {
  const result = await safeCall(call)
  const data = (result as { data?: unknown }).data
  if (result.response.ok && data !== undefined) return data as T
  const failure = handleApiError(result)
  throw new Response(failure.formError, { status: failure.status || 503 })
}

export async function loadRecord(cfg: ResourceConfig, id: string | undefined): Promise<Row> {
  if (!id) throw new Response('Not found.', { status: 404 })
  const data = await loadOrThrow<Record<string, Row>>(cfg.api.get(id))
  return data[cfg.recordKey]
}

/** Option lists for selects that point at other records (e.g. the country of a notice). */
export async function loadLookups(cfg: ResourceConfig): Promise<Record<string, Opt[]>> {
  const out: Record<string, Opt[]> = {}
  for (const [name, load] of Object.entries(cfg.lookups ?? {})) out[name] = await load()
  return out
}

/** For actions: redirect to the list with a success flag, or return the failure for the form. */
export async function finish(call: ApiCall, cfg: ResourceConfig, saved: 'created' | 'updated' | 'deleted') {
  const result = await safeCall(call)
  if (result.response.ok) throw redirect(`/admin/${cfg.key}?saved=${saved}`)
  return handleApiError(result)
}
