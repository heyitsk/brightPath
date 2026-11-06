import { Elysia } from "elysia";

// Tools and HTML forms often send blank filters as `?actorId=&limit=`. Before validation, drop
// query params whose value is empty or whitespace so they mean "not provided" instead of failing
// as an invalid UUID/number (history.md D-045).
//
// Query string only: body fields stay strict (an empty password or name must still be rejected),
// and route params/headers are untouched.
export const emptyQueryAsAbsent = new Elysia({ name: "empty-query-as-absent" }).onTransform({ as: "global" }, (ctx) => {
  const query = ctx.query as Record<string, unknown> | undefined;
  if (!query) return;
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (typeof value === "string" && value.trim() === "") delete query[key];
  }
});
