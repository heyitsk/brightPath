import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { bulkDecide, getItem, listItems, publishItem, rejectItem, restoreItem, unpublishItem, updateItem } from "./news.items.service";
import { newsStats } from "./news.service";

// Routes for everyone who reviews news (COUNSELLOR, EDITOR, ADMIN: D-141): the review queue, and the numbers for its badge.

const note = " Open to any logged-in staff member (COUNSELLOR, EDITOR or ADMIN). Writes need the `X-BP-Admin: 1` header.";

const idParam = t.Object({ id: t.String({ format: "uuid" }) });
const iso = t.String({ format: "date-time" });
const StatusSchema = t.Union([t.Literal("PENDING"), t.Literal("FILTERED"), t.Literal("PUBLISHED"), t.Literal("REJECTED"), t.Literal("UNPUBLISHED"), t.Literal("BASELINE")], {
  description:
    "PENDING = waiting for review; FILTERED = kept out of the queue by the relevance rules (can be restored); PUBLISHED = live on the News page; REJECTED = staff said no; UNPUBLISHED = was live, taken down; BASELINE = already on the site when the source was first read.",
});
const CategorySchema = t.Union(
  [t.Literal("COUNSELLING"), t.Literal("SCHEDULE"), t.Literal("SEAT_MATRIX"), t.Literal("MERIT_LIST"), t.Literal("REGISTRATION"), t.Literal("RESULT"), t.Literal("FEE"), t.Literal("OTHER")],
  { description: "What the notice is about" },
);
const person = t.Union([t.Object({ id: t.String({ format: "uuid" }), name: t.String() }), t.Null()]);

const ItemSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    status: StatusSchema,
    title: t.String({ description: "Title exactly as found on the official page" }),
    publicTitle: t.Union([t.String(), t.Null()], { description: "Cleaned-up title shown on the News page; null = use `title`" }),
    summary: t.Union([t.String(), t.Null()], { description: "The staff-written summary shown on the News page. Required to publish." }),
    snippet: t.Union([t.String(), t.Null()], { description: "A short excerpt from the feed, if the source gives one" }),
    originalUrl: t.String({ description: "The official notice; open it to check the item before publishing" }),
    category: CategorySchema,
    isPinned: t.Boolean({ description: "Pinned items come first on the News page" }),
    slug: t.Union([t.String(), t.Null()], { description: "Address part on the News page; set the first time the notice is published and kept after" }),
    state: t.Union([t.Object({ id: t.String({ format: "uuid" }), name: t.String(), code: t.String() }), t.Null()], { description: "null for a central body" }),
    source: t.Object({ id: t.String({ format: "uuid" }), slug: t.String(), name: t.String(), siteUrl: t.Union([t.String(), t.Null()]), kind: t.String() }),
    sourcePublishedAt: t.Union([iso, t.Null()], { description: "The date the official site gives, if any" }),
    dateBasis: t.Union([t.Literal("SOURCE"), t.Literal("PDF"), t.Literal("FIRST_SEEN")], { description: "Where the date came from; FIRST_SEEN = the site gave none, so this is when we first saw it" }),
    firstSeenAt: iso,
    relevance: t.Object({ score: t.Integer(), reasons: t.Array(t.String(), { description: "Rules that fired: `+mbbs` added to the score, `-pg` took away" }) }),
    duplicateOf: t.Union([t.Object({ id: t.String({ format: "uuid" }), title: t.String(), status: StatusSchema }), t.Null()], { description: "An earlier notice with the same title: a hint that this may be a repeat" }),
    reviewedBy: person,
    reviewedAt: t.Union([iso, t.Null()]),
    publishedBy: person,
    publishedAt: t.Union([iso, t.Null()]),
    updatedAt: iso,
  },
  { description: "One fetched notice" },
);

const editFields = {
  publicTitle: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()], { description: "Clean title for the News page. Null or empty = use the official title" })),
  summary: t.Optional(t.Union([t.String({ minLength: 10, maxLength: 500 }), t.Null()], { description: "One or two lines in your own words (10 to 500 characters)" })),
  category: t.Optional(CategorySchema),
  stateId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()], { description: "The state the notice is about; null = a central or national notice" })),
  isPinned: t.Optional(t.Boolean()),
};

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
  })
  .get(
    "/admin/news/items",
    ({ query }) => listItems(query),
    {
      query: t.Object({
        status: t.Optional({ ...StatusSchema, description: "Which tab. Default PENDING (the review queue)" }),
        stateId: t.Optional(t.String({ format: "uuid" })),
        central: t.Optional(t.Boolean({ description: "True for central bodies only (MCC, NMC, NTA): notices with no state" })),
        sourceId: t.Optional(t.String({ format: "uuid" })),
        category: t.Optional(CategorySchema),
        q: t.Optional(t.String({ maxLength: 100, description: "Words in the title (blank = no search)" })),
        hideRepeats: t.Optional(t.Boolean({ description: "True to hide notices flagged as repeats of an earlier one" })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, description: "Page size (default 25)" })),
        cursor: t.Optional(t.String({ maxLength: 200, description: "`nextCursor` from the previous page" })),
      }),
      detail: {
        summary: "List news items",
        description:
          "The review screen. Newest found first. `counts` gives the number in every status for the same filters (except the status itself), for the tab labels. The cursor is stable while you work: notices you publish or reject do not shift the next page." + note,
      },
      response: {
        200: t.Object({
          items: t.Array(ItemSchema),
          nextCursor: t.Union([t.String(), t.Null()], { description: "Pass as `cursor` for the next page; null on the last page" }),
          counts: t.Record(t.String(), t.Integer(), { description: "Number of items in each status: PENDING, FILTERED, PUBLISHED, REJECTED, UNPUBLISHED, BASELINE" }),
        }),
        ...errorResponses(401, 403, 422),
      },
    },
  )
  .get("/admin/news/items/:id", async ({ params }) => ({ item: await getItem(params.id) }), {
    params: idParam,
    detail: { summary: "Get a news item", description: "One notice with its relevance reasons, repeat hint, and who reviewed and published it." + note },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 422) },
  })
  .patch("/admin/news/items/:id", async ({ staff, params, body }) => ({ item: await updateItem(staff, params.id, body) }), {
    params: idParam,
    body: t.Object(editFields, { minProperties: 1 }),
    detail: {
      summary: "Edit a news item",
      description:
        "Change the wording, category, state or pin of a notice in any status. Counts as a review, so re-scoring leaves it alone. On a published notice the change is live at once and its 'checked on' date moves; its summary cannot be removed. Audited." + note,
    },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 422) },
  })
  .post("/admin/news/items/:id/publish", async ({ staff, params, body }) => ({ item: await publishItem(staff, params.id, body ?? {}) }), {
    params: idParam,
    body: t.Optional(t.Object(editFields)),
    detail: {
      summary: "Publish a news item",
      description:
        "Puts the notice on the public News page. Check it against the official page first. A summary must exist (already saved, or sent in this call): 422 on `summary` otherwise. Any edits sent in the body are saved at the same moment. The address part (`slug`) is made from the public title the first time and kept after. Allowed from PENDING, FILTERED, BASELINE, REJECTED and UNPUBLISHED; 409 if it is already published. Audited." + note,
    },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 409, 422) },
  })
  .post("/admin/news/items/:id/reject", async ({ staff, params, body }) => ({ item: await rejectItem(staff, params.id, body?.note) }), {
    params: idParam,
    body: t.Optional(t.Object({ note: t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()], { description: "Why, for the audit log" })) })),
    detail: { summary: "Reject a news item", description: "Takes the notice out of the queue for good (it can be restored). 409 if it is published (unpublish first) or already rejected. Audited." + note },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 409, 422) },
  })
  .post("/admin/news/items/:id/unpublish", async ({ staff, params }) => ({ item: await unpublishItem(staff, params.id) }), {
    params: idParam,
    detail: { summary: "Unpublish a news item", description: "Takes a published notice off the News page at once. It keeps its address part if it is published again. 409 unless it is published. Audited." + note },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 409, 422) },
  })
  .post("/admin/news/items/:id/restore", async ({ staff, params }) => ({ item: await restoreItem(staff, params.id) }), {
    params: idParam,
    detail: {
      summary: "Send a news item back to the review queue",
      description:
        "For a notice the rules filtered by mistake, or one rejected or unpublished in error: it returns to PENDING. Counts as a review, so re-scoring leaves it in the queue. 409 if it is already waiting or published. Audited." + note,
    },
    response: { 200: t.Object({ item: ItemSchema }), ...errorResponses(401, 403, 404, 409, 422) },
  })
  .post("/admin/news/items/bulk", ({ staff, body }) => bulkDecide(staff, body.ids, body.action), {
    body: t.Object({
      ids: t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 100, description: "Up to 100 notices" }),
      action: t.Union([t.Literal("reject"), t.Literal("restore")], { description: "Publishing is never bulk: every notice needs its own summary" }),
    }),
    detail: {
      summary: "Reject or restore many news items",
      description:
        "For clearing a page of obvious noise. Items that cannot take the action (wrong status, not found) are skipped and listed with the reason; the rest are done. One audit entry per item." + note,
    },
    response: { 200: t.Object({ updated: t.Integer(), skipped: t.Array(t.Object({ id: t.String(), reason: t.String() })) }), ...errorResponses(401, 403, 422) },
  });
