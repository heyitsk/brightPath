import { logger } from "./lib/logger";
import { createExampleWorker } from "./workers/example.worker";

// Separate process from the API: `bun run worker` (or `bun run worker:dev`).
const workers = [createExampleWorker()];

logger.info({ count: workers.length }, "workers started");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down workers");
  await Promise.allSettled(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
