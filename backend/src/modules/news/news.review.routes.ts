import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { newsStats } from "./news.service";

// Routes for everyone who reviews news (COUNSELLOR, EDITOR, ADMIN: D-141). The review queue itself
// (list, edit, publish, reject) arrives in step N3 and joins this file.

const note = " Open to any logged-in staff member (COUNSELLOR, EDITOR or ADMIN).";

export const newsReviewRoutes = new Elysia({ tags: ["Admin · News"] })
  .use(staffGuard())
  .get("/admin/news/stats", () => newsStats(), {
    detail: {
      summary: "News numbers for badges and the source warning",
      description:
        "What waits for review (in total, new in the last 24 hours, and per state: `stateId` null means a central body such as MCC or NMC), how many notices the relevance rules filtered, how many sources are on, off, healthy, degraded or broken, and the sources that need attention with the plain-words reason their last run failed." + note,
    },
    response: {
      200: t.Object({
        pending: t.Object({
          total: t.Integer({ description: "Notices waiting for review" }),
          newLast24h: t.Integer({ description: "Of those, first seen in the last 24 hours" }),
          byState: t.Array(t.Object({ stateId: t.Union([t.String({ format: "uuid" }), t.Null()]), stateName: t.Union([t.String(), t.Null()]), count: t.Integer() }), { description: "Most first" }),
        }),
        filtered: t.Integer({ description: "Notices the relevance rules kept out of the review queue" }),
        sources: t.Object({ active: t.Integer(), off: t.Integer(), ok: t.Integer(), degraded: t.Integer(), broken: t.Integer() }, { description: "ok, degraded and broken count switched-on sources only" }),
        attention: t.Array(
          t.Object({
            id: t.String({ format: "uuid" }),
            slug: t.String(),
            name: t.String(),
            status: t.Union([t.Literal("OK"), t.Literal("DEGRADED"), t.Literal("BROKEN")]),
            lastError: t.Union([t.String(), t.Null()]),
            lastSuccessAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
          }),
        ),
      }),
      ...errorResponses(401, 403),
    },
  });
