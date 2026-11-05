import { Queue } from "bullmq";
import { bullConnection } from "../lib/redis";

export const EXAMPLE_QUEUE = "example";

export interface ExampleJobData {
  message: string;
}

export const exampleQueue = new Queue<ExampleJobData>(EXAMPLE_QUEUE, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
