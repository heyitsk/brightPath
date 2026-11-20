import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env";
import { bullConnection } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { isSupportedKind } from "./adapters";
import { pruneFetchRuns, runSource } from "./ingest";

// Scheduling for the news tool. One repeating job per active source (so a source's interval is
// its own), plus one daily housekeeping job. The API only enqueues; the worker process does the
// fetching (`bun run worker`).

export const NEWS_QUEUE = "news";
const SCHEDULER_PREFIX = "news-source-";
const MAINTENANCE_ID = "news-maintenance";

type JobData = { sourceId?: string };

let queue: Queue | null = null;
export function newsQueue(): Queue {
  queue ??= new Queue(NEWS_QUEUE, {
    connection: bullConnection,
    defaultJobOptions: { removeOnComplete: { age: 3600, count: 200 }, removeOnFail: { age: 7 * 86_400, count: 500 }, attempts: 1 },
  });
  return queue;
}
export async function closeNewsQueue() {
  await queue?.close();
  queue = null;
}

/** "Fetch now" from the admin screen. Repeated clicks while one is waiting are merged into one. */
export async function enqueueFetchNow(sourceId: string): Promise<void> {
  await newsQueue().add("fetch-source", { sourceId } satisfies JobData, { jobId: `manual-${sourceId}` });
}

/**
 * Make the repeating jobs match the database: one per active source that has an adapter, none
 * for anything switched off. Safe to call often. Does nothing while the scheduler is disabled.
 */
export async function syncNewsSchedules(): Promise<{ scheduled: number; removed: number }> {
  if (!env.NEWS_SCHEDULER_ENABLED) return { scheduled: 0, removed: 0 };
  const q = newsQueue();
  const sources = await prisma.newsSource.findMany({ where: { isActive: true }, select: { id: true, kind: true, fetchIntervalMin: true } });
  const wanted = new Map(sources.filter((s) => isSupportedKind(s.kind)).map((s) => [`${SCHEDULER_PREFIX}${s.id}`, s]));

  for (const [id, s] of wanted) {
    await q.upsertJobScheduler(id, { every: s.fetchIntervalMin * 60_000 }, { name: "fetch-source", data: { sourceId: s.id } satisfies JobData });
  }
  await q.upsertJobScheduler(MAINTENANCE_ID, { every: 86_400_000 }, { name: "prune-runs", data: {} });

  let removed = 0;
  for (const scheduler of await q.getJobSchedulers()) {
    const id = scheduler.key ?? scheduler.id;
    if (id?.startsWith(SCHEDULER_PREFIX) && !wanted.has(id)) {
      await q.removeJobScheduler(id);
      removed++;
    }
  }
  return { scheduled: wanted.size, removed };
}

async function handleJob(job: Job<JobData>) {
  if (job.name === "prune-runs") return { pruned: await pruneFetchRuns() };
  const sourceId = job.data.sourceId;
  if (!sourceId) throw new Error("fetch-source job without a sourceId");
  const source = await prisma.newsSource.findUnique({ where: { id: sourceId }, select: { isActive: true, slug: true } });
  if (!source) return { skipped: "source deleted" };
  // A manual "fetch now" is allowed for an inactive source; a scheduled one is not.
  if (!source.isActive && !job.id?.startsWith("manual-")) return { skipped: "source inactive" };
  const summary = await runSource(sourceId);
  logger.info({ source: source.slug, ...summary }, "news fetch done");
  return summary;
}

/** Called once by the worker process. Returns the worker and a timer that keeps the schedules in step with the database. */
export function startNewsWorker(): { worker: Worker; stop: () => Promise<void> } {
  const worker = new Worker<JobData>(NEWS_QUEUE, handleJob, { connection: bullConnection, concurrency: 3 });
  worker.on("failed", (job, err) => logger.error({ job: job?.name, sourceId: job?.data?.sourceId, err: err.message }, "news job failed"));

  const sync = () => syncNewsSchedules().then((r) => logger.info(r, "news schedules in sync"), (e) => logger.error({ err: (e as Error).message }, "news schedule sync failed"));
  void sync();
  const timer = setInterval(sync, 10 * 60_000);

  return {
    worker,
    stop: async () => {
      clearInterval(timer);
      await worker.close();
      await closeNewsQueue();
    },
  };
}
