import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { sendCacheable } from "../../lib/http-cache";
import { CollegeListSchema, CollegePageSchema, PublicOwnershipSchema } from "./college.public.schemas";
import { getPublicCollege, listPublicColleges } from "./college.public.service";

export const collegePublicRoutes = new Elysia({ prefix: "/colleges", tags: ["Colleges"] })
  .get(
    "/",
    async (ctx) => sendCacheable(ctx, await listPublicColleges(ctx.query), { maxAgeSec: 60, staleWhileRevalidateSec: 300 }),
    {
      query: t.Object({
        kind: t.Optional(t.Union([t.Literal("INDIA"), t.Literal("ABROAD")], { description: "Only Indian or only foreign colleges" })),
        country: t.Optional(t.String({ maxLength: 60, description: "Country slug, e.g. `russia`" })),
        state: t.Optional(t.String({ maxLength: 60, description: "State slug, e.g. `maharashtra`" })),
        ownership: t.Optional(PublicOwnershipSchema),
        q: t.Optional(t.String({ maxLength: 100, description: "Words in the college name, short name or city" })),
        minFeeInr: t.Optional(t.Integer({ minimum: 0, maximum: 2_000_000_000, description: "Whole-course fee in rupees, at least" })),
        maxFeeInr: t.Optional(t.Integer({ minimum: 0, maximum: 2_000_000_000, description: "Whole-course fee in rupees, at most (the budget)" })),
        sort: t.Optional(t.Union([t.Literal("name"), t.Literal("fee_asc"), t.Literal("fee_desc")], { description: "`name` (default, A to Z), `fee_asc` (cheapest first) or `fee_desc`" })),
        page: t.Optional(t.Integer({ minimum: 1, maximum: 1000, description: "Page number, starting at 1 (default 1)" })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 50, description: "Colleges per page (default 24)" })),
      }),
      detail: {
        summary: "List colleges",
        description:
          "The college directory. Only colleges that staff have marked ready are listed, and a foreign college only once its country is live. " +
          "Each item is a card with the chips (NMC alert, NMC recognition, WDOMS, NMC 2021 rules), the whole-course fee in rupees and the date its data was last checked. " +
          "`facets` gives the filter options with counts. Supports `ETag` / `If-None-Match`. Unknown country or state slugs simply match nothing.",
      },
      response: { 200: CollegeListSchema, ...errorResponses(422, 429) },
    },
  )
  .get(
    "/:slug",
    async (ctx) => sendCacheable(ctx, { college: await getPublicCollege(ctx.params.slug) }, { maxAgeSec: 60, staleWhileRevalidateSec: 300 }),
    {
      params: t.Object({ slug: t.String({ minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9-]+$", description: "The college's web address part" }) }),
      detail: {
        summary: "A college page",
        description:
          "Everything for one college page. `kind` decides the layout: INDIA fills `india`, ABROAD fills `abroad`. Fees are year by year with the rupee conversion; show `feeRatesAsOf` beside converted amounts. " +
          "`nmc` carries the red alert state and notices; `sources` is the \"Sources and dates\" block. " +
          "404 for a college that does not exist, is not ready, or is a foreign college whose country is not live yet (all look the same). Supports `ETag` / `If-None-Match`.",
      },
      response: { 200: t.Object({ college: CollegePageSchema }), ...errorResponses(404, 422, 429) },
    },
  );
