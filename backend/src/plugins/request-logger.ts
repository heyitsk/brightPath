import { Elysia } from "elysia";
import { logger } from "../lib/logger";

const startTimes = new WeakMap<Request, number>();

// One log line per request: method, path, status, duration. Errors are logged with the stack.
export const requestLogger = new Elysia({ name: "request-logger" })
  .onRequest(({ request }) => {
    startTimes.set(request, performance.now());
  })
  .onAfterResponse({ as: "global" }, ({ request, set, path }) => {
    const start = startTimes.get(request);
    const durationMs = start ? Math.round((performance.now() - start) * 100) / 100 : undefined;
    logger.info(
      { method: request.method, path, status: set.status ?? 200, durationMs },
      "request completed",
    );
  })
  .onError({ as: "global" }, ({ request, path, code, error }) => {
    logger.error({ method: request.method, path, code, err: error }, "request failed");
  });
