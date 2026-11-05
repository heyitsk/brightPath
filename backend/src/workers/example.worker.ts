import { Worker } from "bullmq";
import { logger } from "../lib/logger";
import { bullConnection } from "../lib/redis";
import { EXAMPLE_QUEUE, type ExampleJobData } from "../queues/example.queue";

export function createExampleWorker() {
  const log = logger.child({ worker: EXAMPLE_QUEUE });

  const worker = new Worker<ExampleJobData>(
    EXAMPLE_QUEUE,
    async (job) => {
      log.info({ jobId: job.id, data: job.data }, "processing job");
      // ...real work goes here
      return { processedAt: new Date().toISOString() };
    },
    { connection: bullConnection, concurrency: 5 },
  );

  worker.on("completed", (job) => log.info({ jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "job failed"));
  worker.on("error", (err) => log.error({ err }, "worker error"));

  return worker;
}
