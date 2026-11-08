import { countries } from './sections/countries'
import { nmcNotices } from './sections/nmc-notices'
import { sources } from './sections/sources'
import { states } from './sections/states'
import type { ResourceConfig } from './types'

/** /admin/<key> -> its config. Add a section by adding a file in sections/ and a line here. */
export const REGISTRY: Record<string, ResourceConfig> = Object.fromEntries(
  [states, countries, sources, nmcNotices].map((c) => [c.key, c]),
)
