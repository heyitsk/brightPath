import { Elysia } from "elysia";

const ids = new WeakMap<Request, string>();
const SAFE = /^[A-Za-z0-9._-]{8,64}$/;

/** Id for this request. Falls back to a fresh one if the plugin has not run (e.g. parse errors). */
export function getRequestId(request: Request): string {
  let id = ids.get(request);
  if (!id) {
    id = crypto.randomUUID();
    ids.set(request, id);
  }
  return id;
}

// Accepts a well-formed inbound X-Request-Id (so a proxy/frontend can correlate), else generates
// one. Always echoed on the response so users can quote it when reporting a problem.
export const requestId = new Elysia({ name: "request-id" }).onRequest(({ request, set }) => {
  const inbound = request.headers.get("x-request-id");
  const id = inbound && SAFE.test(inbound) ? inbound : crypto.randomUUID();
  ids.set(request, id);
  set.headers["x-request-id"] = id;
});
