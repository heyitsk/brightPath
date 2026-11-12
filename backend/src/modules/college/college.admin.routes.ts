import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import {
  CollegeDetailSchema,
  CollegeKindSchema,
  CollegeStatusSchema,
  CollegeSummarySchema,
  CreateCollegeBody,
  FaqsBody,
  FeeLineBody,
  SourceLinkBody,
  SourcePurposeSchema,
  UpdateCollegeBody,
  rejectUnknownFields,
} from "./college.schemas";
import {
  addSourceLink, archiveCollege, createCollege, deleteCollege, deleteFee, getCollege, listColleges, markReady, moveToDraft, removeSourceLink, replaceFaqs, setFee, updateCollege, updateSourceLink,
} from "./college.service";
import { dateInput } from "../reference/reference.schemas";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const idParam = t.Object({ id: t.String({ format: "uuid" }) });
const limit = t.Optional(t.Integer({ minimum: 1, maximum: 100, description: "Page size (default 50)" }));
const cursor = t.Optional(t.String({ format: "uuid", description: "`nextCursor` from the previous page" }));
const Detail = t.Object({ college: CollegeDetailSchema });
const detailResponse = { 200: Detail, ...errorResponses(401, 403, 404, 422) };

export const collegeAdminRoutes = new Elysia({ tags: ["Admin · Colleges"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  .get("/admin/colleges", ({ query }) => listColleges(query), {
    query: t.Object({
      kind: t.Optional(CollegeKindSchema),
      status: t.Optional(CollegeStatusSchema),
      countryId: t.Optional(t.String({ format: "uuid" })),
      stateId: t.Optional(t.String({ format: "uuid" })),
      q: t.Optional(t.String({ maxLength: 100, description: "Search in name and city (blank = no search)" })),
      limit,
      cursor,
    }),
    detail: {
      summary: "List colleges",
      description:
        "Colleges A to Z, cursor-paginated, with `total` for the current filter. Each row shows its status and whether it is ready to go live (`readiness`), so the list can flag drafts that are incomplete." + note,
    },
    response: {
      200: t.Object({ items: t.Array(CollegeSummarySchema), total: t.Integer({ description: "How many colleges match the filters, across all pages" }), nextCursor: t.Union([t.String(), t.Null()]) }),
      ...errorResponses(401, 403, 422),
    },
  })
  .post(
    "/admin/colleges",
    async ({ staff, body, set }) => {
      const college = await createCollege(staff, body);
      set.status = 201;
      return { college };
    },
    {
      transform: ({ body }) => rejectUnknownFields(body, CreateCollegeBody),
      body: CreateCollegeBody,
      detail: {
        summary: "Create a college (as a draft)",
        description:
          "Always saved as a DRAFT: nothing is public until `POST /admin/colleges/{id}/ready` succeeds. The slug (the page address) is made from the name and cannot change later. Use `stateId` for an INDIA college and `countryId` for an ABROAD one." + note,
      },
      response: { 201: Detail, ...errorResponses(401, 403, 422) },
    },
  )
  .get("/admin/colleges/:id", async ({ params }) => ({ college: await getCollege(params.id) }), {
    params: idParam,
    detail: {
      summary: "Get a college",
      description: "Everything the edit screen needs: details, fee table with rupee conversions, sources, FAQs, and `readiness` listing exactly what is still missing before Mark ready." + note,
    },
    response: detailResponse,
  })
  .patch("/admin/colleges/:id", async ({ staff, params, body }) => ({ college: await updateCollege(staff, params.id, body) }), {
    params: idParam,
    transform: ({ body }) => rejectUnknownFields(body, UpdateCollegeBody),
    body: UpdateCollegeBody,
    detail: {
      summary: "Update a college",
      description:
        "Send only the fields to change; use the `india` or `abroad` object for kind-specific facts. A live (READY) college can be edited, but an edit that would leave a required detail missing is refused with 422 and nothing is saved." + note,
    },
    response: detailResponse,
  })
  .delete(
    "/admin/colleges/:id",
    async ({ staff, params }) => {
      await deleteCollege(staff, params.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      detail: { summary: "Delete a draft college", description: "Only drafts can be deleted (409 otherwise: archive a college that has been live). The deletion is audited." + note },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  // ---- status ----
  .post("/admin/colleges/:id/ready", async ({ staff, params }) => ({ college: await markReady(staff, params.id) }), {
    params: idParam,
    detail: {
      summary: "Mark ready (publish)",
      description:
        "Makes a draft live. Refused with 422 unless every required detail is filled; `error.fields` then lists each missing item (`path` + plain-words `message`), the same list as `readiness.missing`. Needs: name, city, ownership, description, course length, at least one source, a fee row for every course year (each with a source and, unless INR, an exchange rate), plus the India or abroad checks. 409 for an archived college (move it to draft first). Already-ready is a no-op." + note,
    },
    response: { 200: Detail, ...errorResponses(401, 403, 404, 409, 422) },
  })
  .post("/admin/colleges/:id/draft", async ({ staff, params }) => ({ college: await moveToDraft(staff, params.id) }), {
    params: idParam,
    detail: { summary: "Move back to draft", description: "Takes a live or archived college off the public site and back to DRAFT. Already-draft is a no-op." + note },
    response: detailResponse,
  })
  .post("/admin/colleges/:id/archive", async ({ staff, params }) => ({ college: await archiveCollege(staff, params.id) }), {
    params: idParam,
    detail: { summary: "Archive a college", description: "Takes the college off the public site but keeps everything. Already-archived is a no-op." + note },
    response: detailResponse,
  })
  // ---- fee table ----
  .put(
    "/admin/colleges/:id/fees/:year",
    async ({ staff, params, body }) => ({ college: await setFee(staff, params.id, params.year, body) }),
    {
      params: t.Object({ id: t.String({ format: "uuid" }), year: t.Integer({ minimum: 1, maximum: 12, description: "Course year, 1 = first" }) }),
      body: FeeLineBody,
      detail: {
        summary: "Set one year of fees",
        description:
          "Creates or replaces the fee row for that course year (this is what an inline edit of the fee table calls). The college's rupee total is recalculated in the same step. Returns the whole college so the table, totals and readiness refresh together. 422 if the year is beyond the course length. On a live college, a change that would leave it incomplete is refused." + note,
      },
      response: detailResponse,
    },
  )
  .delete(
    "/admin/colleges/:id/fees/:year",
    async ({ staff, params }) => ({ college: await deleteFee(staff, params.id, params.year) }),
    {
      params: t.Object({ id: t.String({ format: "uuid" }), year: t.Integer({ minimum: 1, maximum: 12 }) }),
      detail: { summary: "Remove one year of fees", description: "Deletes that year's row and recalculates the total. Refused on a live college if the year is required." + note },
      response: detailResponse,
    },
  )
  // ---- sources ----
  .post(
    "/admin/colleges/:id/sources",
    async ({ staff, params, body, set }) => {
      const college = await addSourceLink(staff, params.id, body);
      set.status = 201;
      return { college };
    },
    {
      params: idParam,
      body: SourceLinkBody,
      detail: { summary: "Link a source to a college", description: "Attaches an existing source (see `/admin/sources`) with what it proves and the date it was checked. 409 if the same source and purpose are already linked." + note },
      response: { 201: Detail, ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .patch(
    "/admin/colleges/:id/sources/:linkId",
    async ({ staff, params, body }) => ({ college: await updateSourceLink(staff, params.id, params.linkId, body) }),
    {
      params: t.Object({ id: t.String({ format: "uuid" }), linkId: t.String({ format: "uuid" }) }),
      body: t.Object({ purpose: t.Optional(SourcePurposeSchema), checkedAt: t.Optional(dateInput) }),
      detail: { summary: "Update a source link", description: "Change the purpose or re-confirm the checked date (not in the future)." + note },
      response: { 200: Detail, ...errorResponses(401, 403, 404, 409, 422) },
    },
  )
  .delete(
    "/admin/colleges/:id/sources/:linkId",
    async ({ staff, params }) => ({ college: await removeSourceLink(staff, params.id, params.linkId) }),
    {
      params: t.Object({ id: t.String({ format: "uuid" }), linkId: t.String({ format: "uuid" }) }),
      detail: { summary: "Unlink a source", description: "Removes the link (the source itself stays). Refused on a live college if it was the last one." + note },
      response: detailResponse,
    },
  )
  // ---- FAQs ----
  .put("/admin/colleges/:id/faqs", async ({ staff, params, body }) => ({ college: await replaceFaqs(staff, params.id, body.items) }), {
    params: idParam,
    body: FaqsBody,
    detail: { summary: "Replace the college's FAQs", description: "Send the complete list in display order; it replaces what was there. An empty list removes all FAQs." + note },
    response: detailResponse,
  });
