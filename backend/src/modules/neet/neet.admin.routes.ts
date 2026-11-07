import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { assertNotEmpty, dateInput } from "../reference/reference.schemas";
import { CSV_HEADER } from "./distribution";
import { CategorySchema, RankResponseSchema, UploadReportSchema, YearDetailSchema, YearSchema, cutoffInput, scoreField, yearParam } from "./neet.schemas";
import { createYear, deleteYear, getYearDetail, listYears, previewRank, publishYear, setCutoffs, unpublishYear, updateYear, uploadDistribution } from "./neet.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const nullableText = (max: number, description: string) => t.Union([t.String({ maxLength: max }), t.Null()], { description });
const nullableInt = (min: number, max: number, description: string) => t.Union([t.Integer({ minimum: min, maximum: max }), t.Null()], { description });

export const neetAdminRoutes = new Elysia({ prefix: "/admin/neet", tags: ["Admin · NEET"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  .get(
    "/years",
    async () => listYears(),
    {
      detail: { summary: "List NEET years", description: "Every NEET (UG) exam year, newest first, draft or published." + note },
      response: { 200: t.Object({ items: t.Array(YearSchema) }), ...errorResponses(401, 403) },
    },
  )
  .post(
    "/years",
    async ({ staff, body, set }) => {
      const examYear = await createYear(staff, body);
      set.status = 201;
      return { examYear };
    },
    {
      body: t.Object({
        year: t.Integer({ minimum: 2013, maximum: 2100, examples: [2026] }),
        appeared: t.Integer({ minimum: 1, maximum: 5_000_000, description: "Official number of students who appeared" }),
        qualified: t.Optional(nullableInt(0, 5_000_000, "Official number who qualified, if published")),
        topperScore: t.Optional(nullableInt(-180, 720, "Highest score, if published (used as a cross-check)")),
        resultDate: t.Optional(t.Union([dateInput, t.Null()], { description: "Date NTA declared the result" })),
        methodNote: t.Optional(nullableText(2000, "Plain-words note on how this year's data was published. Shown on \"Data we use\".")),
        sourceId: t.String({ format: "uuid", description: "The official NTA document (create it under Admin · Reference › Sources first)" }),
        checkedAt: dateInput,
      }),
      detail: {
        summary: "Create a NEET year",
        description:
          "Starts a DRAFT year. Next: upload the score counts, set the qualifying cut-offs, check with the preview, then publish." + note,
      },
      response: { 201: t.Object({ examYear: YearDetailSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/years/:year",
    async ({ params }) => ({ examYear: await getYearDetail(params.year) }),
    {
      params: yearParam,
      detail: {
        summary: "Get a NEET year",
        description: "One year with what its uploaded file contains (`groups`), data cross-check `warnings`, and `publishProblems` (what still blocks publishing)." + note,
      },
      response: { 200: t.Object({ examYear: YearDetailSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/years/:year",
    async ({ staff, params, body }) => {
      assertNotEmpty(body);
      return { examYear: await updateYear(staff, params.year, body) };
    },
    {
      params: yearParam,
      body: t.Object({
        appeared: t.Optional(t.Integer({ minimum: 1, maximum: 5_000_000 })),
        qualified: t.Optional(nullableInt(0, 5_000_000, "null clears it")),
        topperScore: t.Optional(nullableInt(-180, 720, "null clears it")),
        resultDate: t.Optional(t.Union([dateInput, t.Null()], { description: "null clears it" })),
        methodNote: t.Optional(nullableText(2000, "null or empty clears it")),
        sourceId: t.Optional(t.String({ format: "uuid" })),
        checkedAt: t.Optional(dateInput),
      }),
      detail: {
        summary: "Update a NEET year",
        description:
          "Send only the fields to change. While the year is published only `checkedAt` and `methodNote` can change (409 otherwise); unpublish first for the rest. To re-confirm the figures are still correct, send a new `checkedAt`." + note,
      },
      response: { 200: t.Object({ examYear: YearDetailSchema }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .delete(
    "/years/:year",
    async ({ staff, params }) => {
      await deleteYear(staff, params.year);
      return { ok: true as const };
    },
    {
      params: yearParam,
      detail: { summary: "Delete a NEET year", description: "Deletes a DRAFT year with its counts, cut-offs and rank table. 409 if published. Audited." + note },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .put(
    "/years/:year/cutoffs",
    async ({ staff, params, body }) => ({ examYear: await setCutoffs(staff, params.year, body.cutoffs) }),
    {
      params: yearParam,
      body: t.Object({ cutoffs: t.Array(cutoffInput, { maxItems: 6, description: "Replaces all cut-offs for the year. Publishing needs GENERAL, EWS, OBC, SC and ST; PWD is optional." }) }),
      detail: {
        summary: "Set qualifying cut-offs",
        description:
          "Replaces the year's qualifying cut-offs. A PwD student qualifies at the lower of their category cut-off and the PWD one. DRAFT years only (409 if published)." + note,
      },
      response: { 200: t.Object({ examYear: YearDetailSchema }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .put(
    "/years/:year/distribution",
    async ({ staff, params, body }) => ({ report: await uploadDistribution(staff, params.year, body) }),
    {
      params: yearParam,
      body: t.Object({
        csv: t.String({
          minLength: 1,
          maxLength: 800_000,
          description:
            `The score counts as CSV text. First line exactly \`${CSV_HEADER}\`. group is OVERALL, GENERAL, EWS, OBC, SC, ST or PWD; ` +
            "score_to may be blank for a single score; candidates is a plain whole number. Scores run -180..720 and must not overlap within a group.",
          examples: [`${CSV_HEADER}\nOVERALL,720,720,3\nOVERALL,715,715,11\nOBC,600,609,5120`],
        }),
        fileName: t.Optional(nullableText(200, "Name of the official file this came from (for the record)")),
        dryRun: t.Optional(t.Boolean({ description: "true = check the file and show the report, save nothing" })),
      }),
      detail: {
        summary: "Upload score counts",
        description:
          "Replaces the year's counts and rebuilds the rank table from them in one step (the table is never edited by hand). " +
          "Use `dryRun: true` first to see the report. Errors list each bad line (422). " +
          "The report's `basis` is EXACT_TIES when every count is for a single score, otherwise BAND_INTERPOLATION. `warnings` are cross-checks; they do not block. DRAFT years only (409 if published)." +
          note,
      },
      response: { 200: t.Object({ report: UploadReportSchema }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .get(
    "/years/:year/preview",
    async ({ params, query }) => previewRank(params.year, query),
    {
      params: yearParam,
      query: t.Object({ score: scoreField, category: CategorySchema, pwd: t.Optional(t.Boolean()) }),
      detail: {
        summary: "Preview a rank",
        description: "The same answer the public `GET /neet/rank` would give, but for any year (including a draft). Use it to check known scores against the official file before publishing. `otherYears` is empty." + note,
      },
      response: { 200: RankResponseSchema, ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .post(
    "/years/:year/publish",
    async ({ staff, params }) => ({ examYear: await publishYear(staff, params.year) }),
    {
      params: yearParam,
      detail: {
        summary: "Publish a NEET year",
        description: "Makes the year available to `GET /neet/rank`. Needs the score counts (with the OVERALL list) and cut-offs for GENERAL, EWS, OBC, SC, ST; otherwise 422 lists what is missing. Audited." + note,
      },
      response: { 200: t.Object({ examYear: YearDetailSchema }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .post(
    "/years/:year/unpublish",
    async ({ staff, params }) => ({ examYear: await unpublishYear(staff, params.year) }),
    {
      params: yearParam,
      detail: { summary: "Unpublish a NEET year", description: "Takes the year off the public API and makes it editable again. Audited." + note },
      response: { 200: t.Object({ examYear: YearDetailSchema }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  );
