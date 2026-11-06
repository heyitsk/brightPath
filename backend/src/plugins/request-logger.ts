import { Elysia } from "elysia";
import { logger } from "../lib/logger";
import { getRequestId } from "./request-id";

const startTimes = new WeakMap<Request, number>();

// One log line per request: method, path, status, duration, request id.
// Query strings are not logged (they can carry phone numbers or names). Errors are logged by
// the error-handler plugin, not here, so a failure never produces two log lines.
export const requestLogger = new Elysia({ name: "request-logger" })
  .onRequest(({ request }) => {
    startTimes.set(request, performance.now());
  })
  .onAfterResponse({ as: "global" }, ({ request, set, path }) => {
    const start = startTimes.get(request);
    const durationMs = start ? Math.round((performance.now() - start) * 100) / 100 : undefined;
    logger.info(
      { requestId: getRequestId(request), method: request.method, path, status: set.status ?? 200, durationMs },
      "request completed",
    );
  });
