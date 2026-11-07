import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { sendCacheable } from "../../lib/http-cache";
import { CategorySchema, DataSourcesResponseSchema, RankResponseSchema, scoreField } from "./neet.schemas";
import { getDataSources, getRank } from "./neet.service";

export const neetRoutes = new Elysia({ prefix: "/neet", tags: ["NEET"] })
  .get(
    "/rank",
    async (ctx) => {
      const { score, category, pwd, year } = ctx.query;
      return sendCacheable(ctx, await getRank({ score, category, pwd, year }), { maxAgeSec: 60, staleWhileRevalidateSec: 300 });
    },
    {
      query: t.Object({
        score: scoreField,
        category: CategorySchema,
        pwd: t.Optional(t.Boolean({ description: "true if the student has a benchmark disability (PwD). Default false." })),
        year: t.Optional(t.Integer({ minimum: 2013, maximum: 2100, description: "NEET (UG) exam year. Default: the newest published year." })),
      }),
      detail: {
        summary: "Predict NEET (UG) rank from a score",
        description:
          "Turns a NEET (UG) score into an All-India rank **range** using the official NTA result data. The same score always gives the same answer " +
          "(`tableVersion` identifies the exact table used). Ranks are ranges because tied students share a band of ranks.\n\n" +
          "- `result.outcome` is `BELOW_CUTOFF` when the score is under the qualifying cut-off; rank fields are then null.\n" +
          "- `result.approximate` is true when the year's data only has counts per mark range; show the estimate as approximate and mention `possibleRankSpan`.\n" +
          "- `categoryRank` / `pwdRank` are null when the year's data does not support them (never guessed).\n" +
          "- `otherYears` gives the same score in every other published year (for \"same score in the other year\").\n" +
          "- `meta.disclaimer` must be shown with the answer.\n\n" +
          "Supports `ETag` / `If-None-Match`. 404 until a year is published; 422 for an unavailable `year` or a score outside -180..720.",
      },
      response: { 200: RankResponseSchema, ...errorResponses(404, 422, 429) },
    },
  )
  .get(
    "/data-sources",
    async (ctx) => sendCacheable(ctx, await getDataSources(), { maxAgeSec: 300, staleWhileRevalidateSec: 600 }),
    {
      detail: {
        summary: "NEET data we use",
        description:
          "One row per published exam year for the \"Data we use\" table: official source, check date, how ranks were derived (`basis`, `approximate`), " +
          "which lists exist (`groups`) and the qualifying cut-offs. Newest year first. Supports `ETag` / `If-None-Match`.",
      },
      response: { 200: DataSourcesResponseSchema, ...errorResponses(429) },
    },
  );
