import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import {
  NmcNoticeSchema,
  NoticeScopeSchema,
  NoticeSeveritySchema,
  SourceKindSchema,
  SourceSchema,
  assertNotEmpty,
  dateInput,
  urlField,
} from "./reference.schemas";
import { createNotice, createSource, deleteNotice, deleteSource, getNotice, getSource, listNotices, listSources, updateNotice, updateSource } from "./provenance.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const idParam = t.Object({ id: t.String({ format: "uuid" }) });
const limit = t.Optional(t.Integer({ minimum: 1, maximum: 100, description: "Page size (default 50)" }));
const cursor = t.Optional(t.String({ format: "uuid", description: "`nextCursor` from the previous page" }));
const nextCursor = t.Union([t.String(), t.Null()], { description: "Pass as `cursor` for the next page; null on the last page" });

const nullableText = (max: number, description: string) => t.Union([t.String({ maxLength: max }), t.Null()], { description });

export const provenanceAdminRoutes = new Elysia({ tags: ["Admin · Reference"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  // ---- sources ----
  .get(
    "/admin/sources",
    ({ query }) => listSources(query),
    {
      query: t.Object({
        kind: t.Optional(SourceKindSchema),
        q: t.Optional(t.String({ maxLength: 100, description: "Search in title and publisher (blank = no search)" })),
        limit,
        cursor,
      }),
      detail: { summary: "List sources", description: "Official documents and pages that facts are traced to. Newest first, cursor-paginated." + note },
      response: { 200: t.Object({ items: t.Array(SourceSchema), nextCursor }), ...errorResponses(401, 403, 422) },
    },
  )
  .post(
    "/admin/sources",
    async ({ staff, body, set }) => {
      const source = await createSource(staff, body);
      set.status = 201;
      return { source };
    },
    {
      body: t.Object({
        kind: SourceKindSchema,
        title: t.String({ minLength: 1, maxLength: 200, examples: ["NEET (UG) 2026 result notice"] }),
        publisher: t.Optional(nullableText(120, "Who published it, e.g. `National Testing Agency`")),
        url: t.Optional(t.Union([urlField, t.Null()])),
        notes: t.Optional(nullableText(2000, "Internal notes for staff")),
      }),
      detail: { summary: "Create a source", description: "Records an official document. The url must be a full http(s) link." + note },
      response: { 201: t.Object({ source: SourceSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/admin/sources/:id",
    async ({ params }) => ({ source: await getSource(params.id) }),
    {
      params: idParam,
      detail: { summary: "Get a source", description: "One source." + note },
      response: { 200: t.Object({ source: SourceSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/admin/sources/:id",
    async ({ staff, params, body }) => {
      assertNotEmpty(body);
      return { source: await updateSource(staff, params.id, body) };
    },
    {
      params: idParam,
      body: t.Object({
        kind: t.Optional(SourceKindSchema),
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        publisher: t.Optional(nullableText(120, "null or empty clears it")),
        url: t.Optional(t.Union([urlField, t.Null()], { description: "null clears it" })),
        notes: t.Optional(nullableText(2000, "null or empty clears it")),
      }),
      detail: { summary: "Update a source", description: "Send only the fields to change." + note },
      response: { 200: t.Object({ source: SourceSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .delete(
    "/admin/sources/:id",
    async ({ staff, params }) => {
      await deleteSource(staff, params.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      detail: { summary: "Delete a source", description: "Removes a source nothing cites. 409 if other records still cite it. The deletion is audited." + note },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  // ---- NMC notices ----
  .get(
    "/admin/nmc-notices",
    ({ query }) => listNotices(query),
    {
      query: t.Object({ scope: t.Optional(NoticeScopeSchema), countryId: t.Optional(t.String({ format: "uuid" })), collegeId: t.Optional(t.String({ format: "uuid" })), isActive: t.Optional(t.Boolean()), limit, cursor }),
      detail: { summary: "List NMC notices", description: "NMC advisories and warnings, newest first, cursor-paginated." + note },
      response: { 200: t.Object({ items: t.Array(NmcNoticeSchema), nextCursor }), ...errorResponses(401, 403, 422) },
    },
  )
  .post(
    "/admin/nmc-notices",
    async ({ staff, body, set }) => {
      const notice = await createNotice(staff, body);
      set.status = 201;
      return { notice };
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 300 }),
        url: urlField,
        publishedAt: dateInput,
        severity: NoticeSeveritySchema,
        scope: NoticeScopeSchema,
        countryId: t.Optional(t.String({ format: "uuid", description: "Required when scope is COUNTRY" })),
        collegeId: t.Optional(t.String({ format: "uuid", description: "Required when scope is COLLEGE" })),
        isActive: t.Optional(t.Boolean({ description: "Default true" })),
        checkedAt: dateInput,
      }),
      detail: {
        summary: "Create an NMC notice",
        description:
          "Records an NMC notice for a country (`scope` COUNTRY + `countryId`) or for one college (`scope` COLLEGE + `collegeId`). Dates cannot be in the future." + note,
      },
      response: { 201: t.Object({ notice: NmcNoticeSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/admin/nmc-notices/:id",
    async ({ params }) => ({ notice: await getNotice(params.id) }),
    {
      params: idParam,
      detail: { summary: "Get an NMC notice", description: "One notice." + note },
      response: { 200: t.Object({ notice: NmcNoticeSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/admin/nmc-notices/:id",
    async ({ staff, params, body }) => {
      assertNotEmpty(body);
      return { notice: await updateNotice(staff, params.id, body) };
    },
    {
      params: idParam,
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
        url: t.Optional(urlField),
        publishedAt: t.Optional(dateInput),
        severity: t.Optional(NoticeSeveritySchema),
        countryId: t.Optional(t.String({ format: "uuid" })),
        isActive: t.Optional(t.Boolean({ description: "false stops the notice from raising an alert" })),
        checkedAt: t.Optional(dateInput),
      }),
      detail: { summary: "Update an NMC notice", description: "Send only the fields to change. To re-confirm a notice is still current, send a new `checkedAt`. The scope cannot change." + note },
      response: { 200: t.Object({ notice: NmcNoticeSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .delete(
    "/admin/nmc-notices/:id",
    async ({ staff, params }) => {
      await deleteNotice(staff, params.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      detail: { summary: "Delete an NMC notice", description: "For notices entered by mistake. To retire a real notice, set `isActive` to false instead. Audited." + note },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 422) },
    },
  );
