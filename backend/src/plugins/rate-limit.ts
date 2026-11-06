import { Elysia } from "elysia";
import { env } from "../config/env";
import { clientIp } from "../lib/client-ip";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";

export interface RateLimitOptions {
  /** Short unique name; part of the Redis key, e.g. `enquiry`. */
  name: string;
  /** Max requests per window. */
  limit: number;
  windowSec: number;
  /** Override the bucket key (default: client IP). Return null to skip limiting this request. */
  key?: (ctx: { request: Request; server?: unknown }) => string | null;
  /** Defaults to env.RATE_LIMIT_ENABLED. */
  enabled?: boolean;
  /** `scoped` limits routes registered after `.use()` on this instance; `global` limits everything after. */
  scope?: "scoped" | "global";
}

// Atomic fixed-window counter: INCR, set expiry on first hit, return count and remaining TTL.
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}
`;

/**
 * Redis-backed rate limiter. Fails OPEN if Redis is unreachable: a cache outage must not take
 * down the whole public site (the failure is logged).
 */
export function rateLimit(opts: RateLimitOptions) {
  const enabled = opts.enabled ?? env.RATE_LIMIT_ENABLED;
  const plugin = new Elysia({ name: `rate-limit:${opts.name}`, seed: opts });
  if (!enabled) return plugin;

  return plugin.onBeforeHandle({ as: opts.scope ?? "scoped" }, async (ctx) => {
    const { request, set } = ctx;
    const server = (ctx as { server?: { requestIP(r: Request): { address: string } | null } | null }).server;
    const who = opts.key ? opts.key({ request, server }) : clientIp({ request, server });
    if (who === null) return;

    let count: number;
    let ttl: number;
    try {
      const res = (await redis.eval(SCRIPT, 1, `rl:${opts.name}:${who}`, opts.windowSec)) as [number, number];
      [count, ttl] = res;
    } catch (err) {
      logger.warn({ err, limiter: opts.name }, "rate limiter unavailable, allowing request");
      return;
    }

    const resetSec = ttl > 0 ? ttl : opts.windowSec;
    const headers = {
      "ratelimit-limit": String(opts.limit),
      "ratelimit-remaining": String(Math.max(0, opts.limit - count)),
      "ratelimit-reset": String(resetSec),
    };
    Object.assign(set.headers, headers);

    if (count > opts.limit) {
      throw new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", undefined, {
        ...headers,
        "retry-after": String(resetSec),
      });
    }
  });
}
