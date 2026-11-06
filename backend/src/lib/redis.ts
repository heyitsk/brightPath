import { Redis } from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env";

// General-purpose client (health checks, caching). Connects on first command.
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

// BullMQ gets plain connection options (it manages its own connections).
// `maxRetriesPerRequest: null` is required for BullMQ workers.
const url = new URL(env.REDIS_URL);
export const bullConnection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password ? decodeURIComponent(url.password) : undefined,
  db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
  maxRetriesPerRequest: null,
};
