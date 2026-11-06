import type { Worker } from "bullmq";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

// Separate process from the API: `bun run worker` (or `bun run worker:dev`).
// Register each queue's worker here as the phase that needs it lands:
//   Phase 4 imports, Phase 6 enquiry delivery (Google Sheets + Resend).
const workers: Worker[] = [];

logger.info({ count: workers.length }, "worker process started");
if (workers.length === 0) {
  logger.info("no queues registered yet; idling");
  setInterval(() => {}, 1 << 30); // keep the process alive until real workers exist
}

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down workers");
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
