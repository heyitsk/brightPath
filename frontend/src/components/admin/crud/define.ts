import type { ResourceConfig, Row } from './types'

/**
 * Keeps each section's columns typed against its own schema row, then stores it as a plain
 * ResourceConfig so the shared pages can handle every section the same way.
 */
export function defineResource<R extends Row>(cfg: ResourceConfig<R>): ResourceConfig {
  return cfg as unknown as ResourceConfig
}
