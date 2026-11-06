import { createHash } from "node:crypto";

export interface CacheOptions {
  /** Browser max-age in seconds. */
  maxAgeSec: number;
  /** CDN/shared-cache max-age; defaults to maxAgeSec. */
  sMaxAgeSec?: number;
  staleWhileRevalidateSec?: number;
}

/** Weak ETag derived from the serialised body. Same data, same tag. */
export function etagFor(body: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 27);
  return `W/"${hash}"`;
}

interface Ctx {
  request: Request;
  set: { headers: Record<string, string | number | undefined>; status?: number | string };
}

/**
 * Wrap the body of a public, cacheable GET. Adds ETag + Cache-Control and answers
 * `If-None-Match` with 304. Usage: `return sendCacheable(ctx, data, { maxAgeSec: 60 })`.
 */
export function sendCacheable<T>(ctx: Ctx, body: T, opts: CacheOptions): T {
  const etag = etagFor(body);
  const parts = ["public", `max-age=${opts.maxAgeSec}`, `s-maxage=${opts.sMaxAgeSec ?? opts.maxAgeSec}`];
  if (opts.staleWhileRevalidateSec) parts.push(`stale-while-revalidate=${opts.staleWhileRevalidateSec}`);
  const cacheControl = parts.join(", ");

  const ifNoneMatch = ctx.request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((v) => v.trim() === etag)) {
    // Elysia passes a returned Response straight through (no response-schema validation), but its
    // route typing only accepts the declared 200 body, so the 304 is typed as `T` here.
    return new Response(null, { status: 304, headers: { etag, "cache-control": cacheControl } }) as unknown as T;
  }

  ctx.set.headers["etag"] = etag;
  ctx.set.headers["cache-control"] = cacheControl;
  return body;
}
