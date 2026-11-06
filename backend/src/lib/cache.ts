import { logger } from "./logger";
import { redis } from "./redis";

// Redis cache for public, published data. Invalidation is by namespace version: bumping the
// version makes every old key unreachable instantly (they expire on their own TTL), so we
// never need SCAN/DEL patterns. Postgres stays the source of truth; Redis failures fall
// through to the loader.

const verKey = (ns: string) => `cache:ver:${ns}`;

export async function cached<T>(ns: string, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  let fullKey: string | undefined;
  try {
    const ver = (await redis.get(verKey(ns))) ?? "0";
    fullKey = `cache:${ns}:${ver}:${key}`;
    const hit = await redis.get(fullKey);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, ns }, "cache read failed, loading directly");
    fullKey = undefined;
  }

  const value = await load();

  if (fullKey) {
    try {
      await redis.set(fullKey, JSON.stringify(value), "EX", ttlSec);
    } catch (err) {
      logger.warn({ err, ns }, "cache write failed");
    }
  }
  return value;
}

/** Call after publish/import/edit so public endpoints serve fresh data. */
export async function invalidate(ns: string): Promise<void> {
  try {
    await redis.incr(verKey(ns));
  } catch (err) {
    logger.warn({ err, ns }, "cache invalidation failed");
  }
}
