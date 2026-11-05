import { Elysia, t } from "elysia";
import { exampleQueue } from "../queues/example.queue";

// Reference route showing how to enqueue background work onto a BullMQ queue.
// Copy this pattern for real features; delete it when no longer needed.
export const jobRoutes = new Elysia({ prefix: "/jobs", tags: ["Jobs"] }).post(
  "/example",
  async ({ body, set }) => {
    const job = await exampleQueue.add("example", { message: body.message });
    set.status = 202;
    return { jobId: String(job.id), queue: exampleQueue.name };
  },
  {
    body: t.Object({
      message: t.String({ minLength: 1, maxLength: 500, description: "Free-text payload handed to the worker" }),
    }),
    detail: {
      summary: "Enqueue an example background job",
      description:
        "Adds a job to the `example` BullMQ queue and returns immediately with 202 Accepted. " +
        "The worker process (`bun run worker`) picks it up asynchronously.",
    },
    response: {
      202: t.Object(
        {
          jobId: t.String({ description: "BullMQ job id" }),
          queue: t.String({ description: "Queue the job was added to" }),
        },
        { description: "Job accepted for processing" },
      ),
    },
  },
);
