import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

app.listen({ port: env.PORT, maxRequestBodySize: env.MAX_BODY_BYTES });

logger.info(`API listening on http://localhost:${env.PORT}`);
logger.info(`OpenAPI docs at http://localhost:${env.PORT}/openapi`);

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  await app.stop();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
