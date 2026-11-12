import { Elysia, t } from "elysia";
import { AppError, errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { commitImport, createImport, discardImport, getImport, listImports, templateCsv } from "./imports.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const iso = t.String({ format: "date-time" });
const nullable = <T extends ReturnType<typeof t.String>>(s: T) => t.Union([s, t.Null()]);
const idParam = t.Object({ id: t.String({ format: "uuid" }) });
const UploadKindSchema = t.Union([t.Literal("COLLEGES"), t.Literal("FEES")], {
  description: "COLLEGES = a list of colleges (India or abroad). FEES = one row per college per course year.",
});
const ActionSchema = t.Union([t.Literal("CREATE"), t.Literal("UPDATE"), t.Literal("UNCHANGED"), t.Literal("SKIP"), t.Literal("ERROR")], {
  description: "CREATE = new. UPDATE = changes something stored. UNCHANGED = already the same. SKIP = left alone (e.g. already live). ERROR = problem, will not be saved.",
});
const Counts = t.Object({ CREATE: t.Integer(), UPDATE: t.Integer(), UNCHANGED: t.Integer(), SKIP: t.Integer(), ERROR: t.Integer() });

const BatchSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    kind: t.Union([UploadKindSchema, t.Literal("MOCK_SAMPLE")]),
    filename: t.String(),
    status: t.Union([t.Literal("UPLOADED"), t.Literal("VALIDATED"), t.Literal("COMMITTED"), t.Literal("FAILED")], {
      description: "VALIDATED = uploaded and previewed, waiting to be saved. COMMITTED = saved.",
    }),
    counts: t.Union([Counts, t.Null()], { description: "Row counts by action (at upload time, or at save time once saved)" }),
    result: t.Union([t.Record(t.String(), t.Integer()), t.Null()], { description: "After saving: what was written, e.g. `{ created, updated }`" }),
    createdById: nullable(t.String()),
    createdAt: iso,
    committedAt: t.Union([iso, t.Null()]),
  },
  { description: "One upload" },
);

const PreviewItemSchema = t.Object(
  {
    line: t.Integer({ description: "Row number in the file" }),
    action: ActionSchema,
    label: t.String({ description: 'e.g. "Altai State Medical University (Russia)" or "…, year 3"' }),
    detail: nullable(t.String()),
    slug: nullable(t.String()),
    targetId: t.Union([t.String({ format: "uuid" }), t.Null()], { description: "The college that already exists, if any" }),
    message: t.Union([t.String(), t.Null()], { description: "Plain-words explanation. Always set for ERROR, SKIP and UPDATE." }),
    changes: t.Array(t.Object({ field: t.String(), current: nullable(t.String()), uploaded: nullable(t.String()) }), { description: "UPDATE rows: each field that would change" }),
    warnings: t.Array(t.String(), { description: "Do not block the row, but are worth a look" }),
  },
  { description: "What one row of the file would do" },
);

const PreviewSchema = t.Object(
  {
    sheet: t.String(),
    totalRows: t.Integer(),
    counts: Counts,
    groups: t.Record(t.String(), t.Integer(), { description: "New rows grouped, e.g. per country (colleges) or per college (fees)" }),
    ignoredColumns: t.Array(t.String(), { description: "Header cells that matched no known column; usually a typo" }),
    notices: t.Array(t.String(), { description: "File-level messages to show above the preview" }),
    canSave: t.Boolean({ description: "True when saving would create or change something" }),
    hasErrors: t.Boolean({ description: "True when some rows have problems. Saving then needs `skipBadRows`." }),
    itemsTotal: t.Integer({ description: "Rows matching the `action` filter" }),
    offset: t.Integer(),
    items: t.Array(PreviewItemSchema, { description: "Errors first, then skipped, updated, created, unchanged; or by row number when filtered by `action`" }),
  },
  { description: "The preview shown before anything is saved" },
);

const previewQuery = {
  action: t.Optional(ActionSchema),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 500, description: "Rows per page (default 100)" })),
  offset: t.Optional(t.Integer({ minimum: 0, description: "Rows to skip (default 0)" })),
};

export const importsAdminRoutes = new Elysia({ tags: ["Admin · Imports"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  .get("/admin/imports", ({ query }) => listImports(query), {
    query: t.Object({
      kind: t.Optional(t.Union([UploadKindSchema, t.Literal("MOCK_SAMPLE")])),
      status: t.Optional(t.Union([t.Literal("UPLOADED"), t.Literal("VALIDATED"), t.Literal("COMMITTED"), t.Literal("FAILED")])),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      cursor: t.Optional(t.String({ format: "uuid" })),
    }),
    detail: { summary: "List uploads", description: "Newest first. Shows both waiting-to-save uploads and saved ones." + note },
    response: { 200: t.Object({ items: t.Array(BatchSchema), nextCursor: nullable(t.String()) }), ...errorResponses(401, 403, 422) },
  })
  .get("/admin/imports/templates/:kind", ({ params, set }) => {
    set.headers["content-type"] = "text/csv; charset=utf-8";
    set.headers["content-disposition"] = `attachment; filename="${params.kind.toLowerCase()}-template.csv"`;
    return templateCsv(params.kind);
  }, {
    params: t.Object({ kind: UploadKindSchema }),
    detail: { summary: "Download a CSV template", description: "The expected column headings with two example rows (delete them before uploading). Excel files use the same headings; column order does not matter." + note },
    response: { 200: t.String({ description: "CSV text" }), ...errorResponses(401, 403, 422) },
  })
  .post(
    "/admin/imports",
    async ({ staff, query, body, set }) => {
      const bytes = new Uint8Array(await body.file.arrayBuffer());
      if (bytes.length === 0) throw AppError.invalid("The file is empty.", [{ path: "file", message: "The file is empty." }]);
      const res = await createImport(staff, query.kind, body.file.name || "upload", bytes, query);
      set.status = 201;
      return res;
    },
    {
      query: t.Object({ kind: UploadKindSchema, ...previewQuery }),
      body: t.Object({ file: t.File({ description: "An Excel (.xlsx) or CSV (.csv) file, up to 1 MB and 5,000 rows" }) }),
      type: "multipart/form-data",
      detail: {
        summary: "Upload a file and preview it (nothing is saved yet)",
        description:
          "Send the file as multipart form data (field `file`) with `?kind=COLLEGES` or `?kind=FEES`. The file is read and checked, and a preview of what saving would do is returned: counts, then every row with its action and a plain-words message. Nothing is changed in the catalogue until `POST /admin/imports/{id}/commit`. File-level problems (unreadable file, missing columns, too many rows) return 422 with `fields[0].path = \"file\"`.\n\n" +
          "**COLLEGES:** columns Country (or State for India colleges), College, City, and optionally Kind, Ownership, Established, Course length (months), Website, Teaching language, Intake, Internship months, Seats for Indians, MBBS seats, Hospital, Hospital beds, Verified, Note. New colleges are always drafts. Existing colleges are never overwritten, only empty fields are filled.\n\n" +
          "**FEES:** columns College (or Slug), Year, Tuition, Currency, and optionally Country/State (to tell apart same-named colleges), Hostel, Other, Source URL, Source, Checked on. A fee row replaces the stored one for that college and year." + note,
      },
      response: { 201: t.Object({ batch: BatchSchema, preview: PreviewSchema }), ...errorResponses(401, 403, 422) },
    },
  )
  .get("/admin/imports/:id", ({ params, query }) => getImport(params.id, query), {
    params: idParam,
    query: t.Object(previewQuery),
    detail: {
      summary: "Get an upload (with a fresh preview if not saved yet)",
      description: "While the upload is waiting to be saved the preview is recomputed against the data as it is now, so it is never stale. After saving, `preview` is null and `batch.result` / `errors` describe what happened." + note,
    },
    response: {
      200: t.Object({ batch: BatchSchema, preview: t.Union([PreviewSchema, t.Null()]), errors: t.Array(t.Object({ line: t.Integer(), label: t.String(), message: nullable(t.String()) })) }),
      ...errorResponses(401, 403, 404, 422),
    },
  })
  .post(
    "/admin/imports/:id/commit",
    async ({ staff, params, body }) => commitImport(staff, params.id, { skipBadRows: body?.skipBadRows }),
    {
      params: idParam,
      body: t.Optional(t.Object({ skipBadRows: t.Optional(t.Boolean({ description: "Save the valid rows and leave out the ones with problems" })) })),
      detail: {
        summary: "Save an upload",
        description:
          "Recomputes the preview against the current data and saves it in one step: all of it or none of it. 422 listing the problem rows if any row has an error, unless `skipBadRows` is true. 409 if the upload was already saved. Rows that change nothing are left alone." + note,
      },
      response: { 200: t.Object({ batch: BatchSchema, result: t.Record(t.String(), t.Integer(), { description: "COLLEGES: `created`, `updated`. FEES: also `colleges` and `sourcesCreated`." }) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .delete(
    "/admin/imports/:id",
    async ({ staff, params }) => {
      await discardImport(staff, params.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      detail: { summary: "Discard an unsaved upload", description: "Throws away an upload that has not been saved. A saved upload is kept as a record (409)." + note },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  );
