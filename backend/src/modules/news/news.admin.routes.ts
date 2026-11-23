import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { slugField, urlField } from "../reference/reference.schemas";
import { createSource, deleteSource, getSource, listRuns, listSources, rescoreItems, runSourceNow, testRelevance, testSource, toSlimSource, updateSource } from "./news.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const idParam = t.Object({ id: t.String({ format: "uuid" }) });
const iso = t.String({ format: "date-time" });
const nullableIso = t.Union([iso, t.Null()]);

const KindSchema = t.Union([t.Literal("RSS"), t.Literal("WP_REST"), t.Literal("HTML_LIST"), t.Literal("JSON_LIST"), t.Literal("HTML_JS")], {
  description:
    "How the source is read. `RSS` = RSS/Atom feed; `WP_REST` = WordPress JSON API; `HTML_LIST` = a normal web page, read with the settings in `config` (needs `scope`); `JSON_LIST` = a JSON address that lists notices (the data behind a JavaScript page), read with `itemsPath`, `titlePath` and an address setting; `HTML_JS` = a page that cannot be read: it needs a browser, or it is closed to our bot. `canFetch` says whether the kind can be read today.",
});
const StatusSchema = t.Union([t.Literal("OK"), t.Literal("DEGRADED"), t.Literal("BROKEN")], {
  description: "Health. DEGRADED = several failed runs in a row. BROKEN = many failed runs, or it keeps returning nothing where it used to return notices.",
});
const configField = t.Record(t.String(), t.Unknown(), {
  description:
    "Reading settings. `HTML_LIST`: `scope` (CSS selector of the area holding the notices; required), `exclude`, `row`, `titleSelector`, `dateSelector`, `dateFromUrl` (regex with named groups y, m, d), `skipText`, `onlyText`, `skipHref`, `onlyHref` (lists of regex sources), `postbackLinks` (true for pages whose notices open through an ASP.NET postback button: each gets an address made from its title), `minTitleLength`, `maxItems`, `order` (`auto`, `newest-first`, `oldest-first`), `generic` (true to read the whole page while trying a site out). `JSON_LIST`: `itemsPath` (dotted path, or a list of paths, to the list of notices), `titlePath`, `urlPath` or `urlTemplate` (like `https://site/notice/{Id}`), `datePath`, `snippetPath`, plus `minTitleLength`, `maxItems`, `order`. `WP_REST`: `apiUrl`. Any kind: `allowInsecureTls` (true to read a site whose certificate is expired or incomplete).",
});
const nullableText = (max: number, description: string) => t.Union([t.String({ maxLength: max }), t.Null()], { description });

const SourceSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    slug: t.String(),
    name: t.String(),
    state: t.Union([t.Object({ id: t.String({ format: "uuid" }), name: t.String(), code: t.String() }), t.Null()], { description: "The state this source speaks for; null for a central body (MCC, NTA, NMC)" }),
    kind: KindSchema,
    listUrl: t.String({ description: "The page, feed or API address that is fetched" }),
    siteUrl: t.Union([t.String(), t.Null()], { description: "The site's home page" }),
    config: t.Record(t.String(), t.Unknown()),
    isActive: t.Boolean({ description: "Scheduled fetching is on. A source whose kind cannot be read (`HTML_JS`) cannot be switched on." }),
    fetchIntervalMin: t.Integer({ description: "Minutes between fetches" }),
    notes: t.Union([t.String(), t.Null()]),
    canFetch: t.Boolean({ description: "False for kinds that cannot be read (`HTML_JS`)" }),
    status: StatusSchema,
    lastRunAt: nullableIso,
    lastSuccessAt: nullableIso,
    lastItemCount: t.Integer({ description: "Notices found on the last run that found any" }),
    consecutiveFailures: t.Integer(),
    consecutiveEmptyRuns: t.Integer({ description: "Runs in a row that found nothing although earlier runs found notices" }),
    lastError: t.Union([t.String(), t.Null()], { description: "Plain-words reason the last run failed; null after a good run" }),
    baselineAt: t.Union([iso, t.Null()], { description: "When the first read recorded what was already on the site; null until something has been found" }),
    itemCount: t.Integer({ description: "Notices stored for this source, in any status" }),
    pendingCount: t.Integer({ description: "Notices waiting for staff review" }),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "One official site that is watched for notices" },
);

const PreviewSchema = t.Object(
  {
    ok: t.Boolean(),
    error: t.Union([t.String(), t.Null()], { description: "Plain-words reason the test failed" }),
    httpStatus: t.Union([t.Integer(), t.Null()]),
    requestedUrl: t.String({ description: "The address that was actually requested" }),
    itemsFound: t.Integer(),
    itemsNew: t.Integer({ description: "Found but not stored yet for this source" }),
    items: t.Array(
      t.Object({
        title: t.String(),
        url: t.String(),
        sourcePublishedAt: t.Union([t.String(), t.Null()]),
        dateBasis: t.Union([t.Literal("SOURCE"), t.Literal("PDF"), t.Literal("FIRST_SEEN")]),
        snippet: t.Union([t.String(), t.Null()]),
        isNew: t.Boolean(),
        relevant: t.Boolean({ description: "Whether the relevance rules would send it to the review queue (true) or the Filtered tab (false)" }),
        score: t.Integer({ description: "Relevance score; the setting `news.relevanceThreshold` is the line" }),
        category: t.String({ description: "What the notice is about: COUNSELLING, SCHEDULE, SEAT_MATRIX, MERIT_LIST, REGISTRATION, RESULT, FEE or OTHER" }),
        reasons: t.Array(t.String(), { description: "The rules that fired: `+mbbs` added to the score, `-pg` took away" }),
      }),
      { description: "The first 30 notices, newest first as the site lists them" },
    ),
  },
  { description: "What a real fetch would find. Nothing was stored." },
);

const RunSchema = t.Object({
  id: t.String({ format: "uuid" }),
  startedAt: iso,
  durationMs: t.Integer(),
  outcome: t.Union([t.Literal("OK"), t.Literal("NOT_MODIFIED"), t.Literal("ERROR"), t.Literal("BLOCKED_BY_ROBOTS")]),
  httpStatus: t.Union([t.Integer(), t.Null()]),
  itemsFound: t.Integer(),
  itemsNew: t.Integer(),
  error: t.Union([t.String(), t.Null()]),
});

const sourceFields = {
  name: t.String({ minLength: 2, maxLength: 160, examples: ["Atal Medical and Research University, Himachal Pradesh"] }),
  stateId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()], { description: "Leave null for a central body" })),
  kind: KindSchema,
  listUrl: urlField,
  siteUrl: t.Optional(t.Union([urlField, t.Null()])),
  config: t.Optional(configField),
  isActive: t.Optional(t.Boolean({ description: "Default false for a new source: test it first, then switch it on" })),
  fetchIntervalMin: t.Optional(t.Integer({ minimum: 15, maximum: 1440, description: "Minutes between fetches (15 to 1440, default 180)" })),
  notes: t.Optional(nullableText(2000, "Internal notes for staff")),
};

// The slim source row that a COUNSELLOR gets (D-191): enough to filter the review queue by source. The scraper settings,
// notes, addresses and error text are editors' working detail and are left out.
const SLIM_KEYS = ["id", "slug", "name", "state", "kind", "isActive", "status"] as const;
const SourceListItemSchema = t.Composite(
  [t.Pick(SourceSchema, [...SLIM_KEYS]), t.Partial(t.Omit(SourceSchema, [...SLIM_KEYS]))],
  { description: "One watched site. Staff with role EDITOR or ADMIN get every field; a COUNSELLOR gets only `id`, `slug`, `name`, `state`, `kind`, `isActive` and `status`" },
);

// Read-only list open to every staff role. Everything that writes, and the by-id routes, stay EDITOR-only below.
export const newsSourceReadRoutes = new Elysia({ tags: ["Admin · News"] })
  .use(staffGuard())
  .get("/admin/news/sources", async ({ staff, query }) => {
    const { items, attentionCount } = await listSources(query);
    return { items: staff.role === "COUNSELLOR" ? items.map(toSlimSource) : items, attentionCount };
  }, {
    query: t.Object({
      kind: t.Optional(KindSchema),
      status: t.Optional(StatusSchema),
      stateId: t.Optional(t.String({ format: "uuid" })),
      isActive: t.Optional(t.Boolean()),
      q: t.Optional(t.String({ maxLength: 100, description: "Search in name and slug" })),
    }),
    detail: {
      summary: "List news sources",
      description:
        "Every official site that is watched, switched-on ones first, with health and counts. `attentionCount` is how many switched-on sources are not healthy (for a badge). No paging: the list is a few dozen rows. Open to every staff role; a COUNSELLOR gets a slim row (`id`, `slug`, `name`, `state`, `kind`, `isActive`, `status`) so they can filter the review queue by source, while EDITOR and ADMIN get every field. The by-id routes and all writes need role EDITOR or ADMIN.",
    },
    response: { 200: t.Object({ items: t.Array(SourceListItemSchema), attentionCount: t.Integer() }), ...errorResponses(401, 403, 422) },
  });

export const newsAdminRoutes = new Elysia({ tags: ["Admin · News"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  .get("/admin/news/sources/:id", async ({ params }) => ({ source: await getSource(params.id) }), {
    params: idParam,
    detail: { summary: "Get a news source", description: "One source with its health and counts." + note },
    response: { 200: t.Object({ source: SourceSchema }), ...errorResponses(401, 403, 404, 422) },
  })
  .post(
    "/admin/news/sources",
    async ({ staff, body, set }) => {
      const source = await createSource(staff, body);
      set.status = 201;
      return { source };
    },
    {
      body: t.Object({ slug: slugField, ...sourceFields }),
      detail: {
        summary: "Add a news source",
        description:
          "Registers a site to watch. It starts switched off: use `POST /admin/news/sources/{id}/test` to see what would be found, then switch it on with `PATCH`. A source whose kind cannot be read (`HTML_JS`) cannot be switched on. Audited." + note,
      },
      response: { 201: t.Object({ source: SourceSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .patch(
    "/admin/news/sources/:id",
    async ({ staff, params, body }) => ({ source: await updateSource(staff, params.id, body) }),
    {
      params: idParam,
      body: t.Partial(t.Object(sourceFields), { minProperties: 1 }),
      detail: {
        summary: "Edit a news source",
        description:
          "Send only the fields to change. Changing the address, kind or settings clears the stored change markers. Switching a source back on gives it a clean health record. The slug cannot change. Audited." + note,
      },
      response: { 200: t.Object({ source: SourceSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .delete(
    "/admin/news/sources/:id",
    async ({ staff, params }) => {
      await deleteSource(staff, params.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      detail: {
        summary: "Delete a news source",
        description: "Only a source with no stored notices can be deleted (409 otherwise); switch it off instead. Audited." + note,
      },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .post("/admin/news/sources/:id/test", ({ params }) => testSource(params.id), {
    params: idParam,
    detail: {
      summary: "Test a news source",
      description:
        "Fetches the source now and reads it exactly as a scheduled run would, then shows what was found and which notices are new. Stores nothing and does not change the source's health. Slow sites can take up to 20 seconds. The site's robots.txt and the polite request delay still apply." + note,
    },
    response: { 200: PreviewSchema, ...errorResponses(401, 403, 404, 422) },
  })
  .post(
    "/admin/news/sources/:id/run",
    async ({ params, set }) => {
      await runSourceNow(params.id);
      set.status = 202;
      return { queued: true as const };
    },
    {
      params: idParam,
      detail: {
        summary: "Fetch a news source now",
        description:
          "Queues an immediate fetch (also for a switched-off source). Answers 202 at once; the result shows up in the source's health and run history within a minute. Repeated clicks while one is waiting count as one. 422 if the source's kind cannot be fetched yet; 503 if the job queue is down." + note,
      },
      response: { 202: t.Object({ queued: t.Literal(true) }, { description: "Queued" }), ...errorResponses(401, 403, 404, 422, 503) },
    },
  )
  .get("/admin/news/sources/:id/runs", ({ params, query }) => listRuns(params.id, query.limit), {
    params: idParam,
    query: t.Object({ limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, description: "How many runs (default 30), newest first" })) }),
    detail: { summary: "Recent fetch runs of a source", description: "The last 30 days of fetch attempts, newest first, so staff can see why a source is unhealthy." + note },
    response: { 200: t.Object({ items: t.Array(RunSchema) }), ...errorResponses(401, 403, 404, 422) },
  })
  .post("/admin/news/relevance/test", ({ body }) => testRelevance(body.title), {
    body: t.Object({ title: t.String({ minLength: 1, maxLength: 400, examples: ["Special stray round counselling for MBBS/BDS 2026"] }) }),
    detail: {
      summary: "Test the relevance rules on a title",
      description:
        "Shows what the rules make of a notice title: its score, the category, whether it would go to the review queue (`relevant`) or the Filtered tab, and which rules fired (`+mbbs` added to the score, `-pg` took away; `(soft)` means the title names MBBS or NEET UG so the penalty was reduced). Use it to understand why a notice was filtered. Stores nothing." + note,
    },
    response: {
      200: t.Object({
        threshold: t.Integer({ description: "The current setting `news.relevanceThreshold`" }),
        score: t.Integer(),
        category: t.Union([t.Literal("COUNSELLING"), t.Literal("SCHEDULE"), t.Literal("SEAT_MATRIX"), t.Literal("MERIT_LIST"), t.Literal("REGISTRATION"), t.Literal("RESULT"), t.Literal("FEE"), t.Literal("OTHER")]),
        relevant: t.Boolean(),
        reasons: t.Array(t.String()),
      }),
      ...errorResponses(401, 403, 422),
    },
  })
  .post(
    "/admin/news/rescore",
    async ({ staff, body }) => rescoreItems(staff, body ?? {}),
    {
      body: t.Optional(t.Object({ dryRun: t.Optional(t.Boolean({ description: "True to only count what would move, saving nothing" })), sourceId: t.Optional(t.String({ format: "uuid", description: "Limit to one source" })) })),
      detail: {
        summary: "Re-apply the relevance rules to waiting notices",
        description:
          "Run it after changing the rules or the setting `news.relevanceThreshold`. Looks at notices that are waiting (`PENDING`) or filtered (`FILTERED`) and that no staff member has handled, re-scores them, and moves them between the review queue and the Filtered tab. Notices staff have reviewed, published or rejected are never touched. Also fills in the 'repeat of' flag on older notices. Audited unless `dryRun`." + note,
      },
      response: {
        200: t.Object({
          threshold: t.Integer(),
          examined: t.Integer({ description: "Waiting or filtered notices looked at" }),
          changed: t.Integer({ description: "Notices whose score, category or status changed" }),
          toPending: t.Integer({ description: "Moved from Filtered to the review queue" }),
          toFiltered: t.Integer({ description: "Moved from the review queue to Filtered" }),
          repeatsFlagged: t.Integer({ description: "Notices newly flagged as repeats of an earlier one" }),
          dryRun: t.Boolean(),
        }),
        ...errorResponses(401, 403, 422),
      },
    },
  );
