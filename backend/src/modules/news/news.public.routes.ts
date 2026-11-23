import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { sendCacheable } from "../../lib/http-cache";
import { getPublicNews, listPublicNews } from "./news.items.service";

// The public News page (plan §15.5 step 7). Only notices that staff have checked and published.
// Each item links to the official original; the site does not copy or host the notice itself (D-139).

const CategorySchema = t.Union(
  [t.Literal("COUNSELLING"), t.Literal("SCHEDULE"), t.Literal("SEAT_MATRIX"), t.Literal("MERIT_LIST"), t.Literal("REGISTRATION"), t.Literal("RESULT"), t.Literal("FEE"), t.Literal("OTHER")],
  { description: "What the notice is about" },
);

const NewsItemSchema = t.Object(
  {
    slug: t.String({ description: "The notice's web address part: `/news/<slug>`" }),
    title: t.String({ description: "The headline: the staff-cleaned title, or the official one" }),
    summary: t.String({ description: "Short summary written by staff" }),
    category: CategorySchema,
    isPinned: t.Boolean({ description: "Pinned notices are listed first" }),
    state: t.Union([t.Object({ slug: t.String(), name: t.String() }), t.Null()], { description: "The state it is about; null for a national or central notice (MCC, NMC, NTA)" }),
    source: t.Object({ name: t.String({ description: "Who published it, e.g. the state's medical education directorate" }), siteUrl: t.Union([t.String(), t.Null()]) }),
    originalUrl: t.String({ description: "The official notice. Show it as \"Read the official notice\"" }),
    sourcePublishedOn: t.Union([t.String({ format: "date" }), t.Null()], { description: "The date the official site gives; null when it gives none" }),
    dateBasis: t.Union([t.Literal("SOURCE"), t.Literal("PDF"), t.Literal("FIRST_SEEN")], { description: "FIRST_SEEN means the site gave no date (`sourcePublishedOn` is null): show `firstSeenAt` as \"added on\", not \"published on\"" }),
    firstSeenAt: t.String({ format: "date-time", description: "When BrightPath's fetcher first found the notice on the official site. Use it as the \"added on\" date when `dateBasis` is FIRST_SEEN. A source's very first read records the notices already on the site, so those carry that day." }),
    publishedAt: t.String({ format: "date-time", description: "When staff put it on the News page (after review). Later than `firstSeenAt`; it decides the order of the list" }),
    checkedOn: t.Union([t.String({ format: "date" }), t.Null()], { description: "When staff last checked it against the official notice: show it as \"checked on\"" }),
  },
  { description: "One published notice" },
);

export const newsPublicRoutes = new Elysia({ prefix: "/news", tags: ["News"] })
  .get(
    "/",
    async (ctx) => sendCacheable(ctx, await listPublicNews(ctx.query), { maxAgeSec: 60, staleWhileRevalidateSec: 300 }),
    {
      query: t.Object({
        state: t.Optional(t.String({ maxLength: 60, description: "State slug, e.g. `himachal-pradesh`" })),
        central: t.Optional(t.Boolean({ description: "True for national and central notices only (MCC, NMC, NTA)" })),
        category: t.Optional(CategorySchema),
        q: t.Optional(t.String({ maxLength: 100, description: "Words in the title or summary" })),
        page: t.Optional(t.Integer({ minimum: 1, maximum: 1000, description: "Page number, starting at 1 (default 1)" })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 50, description: "Notices per page (default 20)" })),
      }),
      detail: {
        summary: "List news",
        description:
          "Admission and counselling notices from official sites, checked by BrightPath staff. Pinned first, then newest published first. `facets` gives the filter options with counts (each counted without its own filter, so choosing a state keeps the others visible; `centralCount` is the national notices). For the latest three on a page, ask for `pageSize=3`. Supports `ETag` / `If-None-Match`.",
      },
      response: {
        200: t.Object({
          items: t.Array(NewsItemSchema),
          page: t.Integer(),
          pageSize: t.Integer(),
          total: t.Integer({ description: "Notices matching the filters, across all pages" }),
          facets: t.Object({
            states: t.Array(t.Object({ slug: t.String(), name: t.String(), count: t.Integer() })),
            centralCount: t.Integer(),
            categories: t.Array(t.Object({ category: CategorySchema, count: t.Integer() })),
          }),
        }),
        ...errorResponses(422, 429),
      },
    },
  )
  .get(
    "/:slug",
    async (ctx) => sendCacheable(ctx, { news: await getPublicNews(ctx.params.slug) }, { maxAgeSec: 60, staleWhileRevalidateSec: 300 }),
    {
      params: t.Object({ slug: t.String({ minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9-]+$", description: "The notice's web address part" }) }),
      detail: {
        summary: "A news item",
        description: "One published notice. 404 if it does not exist or has been taken down (both look the same). Supports `ETag` / `If-None-Match`.",
      },
      response: { 200: t.Object({ news: NewsItemSchema }), ...errorResponses(404, 422, 429) },
    },
  );
