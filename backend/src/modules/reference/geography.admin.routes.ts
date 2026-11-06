import { Elysia, t } from "elysia";
import { AppError, errorResponses } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { staffGuard } from "../../plugins/auth";
import { assertNotEmpty, CountrySchema, CountryStatusSchema, StateSchema, aliasesField, slugField, sortOrderField } from "./reference.schemas";
import { createCountry, createState, listCountries, listStates, toCountryDto, toStateDto, updateCountry, updateState } from "./geography.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const idParam = t.Object({ id: t.String({ format: "uuid" }) });

const stateCode = t.String({ pattern: "^[A-Z]{2,3}$", description: "Short upper-case code, e.g. `UP`", examples: ["UP"] });
const isoCode = t.String({ pattern: "^[A-Z]{2}$", description: "ISO 3166-1 alpha-2 country code, e.g. `RU`", examples: ["RU"] });
const name = t.String({ minLength: 1, maxLength: 80 });

export const geographyAdminRoutes = new Elysia({ tags: ["Admin · Reference"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  // ---- states ----
  .get(
    "/admin/states",
    async ({ query }) => ({ items: await listStates({ isLive: query.isLive }) }),
    {
      query: t.Object({ isLive: t.Optional(t.Boolean({ description: "Only live (true) or not-yet-live (false) states" })) }),
      detail: {
        summary: "List states",
        description: "All Indian states and union territories, live ones first, then by sort order and name. The list is small, so it is not paginated." + note,
      },
      response: { 200: t.Object({ items: t.Array(StateSchema) }), ...errorResponses(401, 403, 422) },
    },
  )
  .post(
    "/admin/states",
    async ({ staff, body, set }) => {
      const state = await createState(staff, body);
      set.status = 201;
      return { state };
    },
    {
      body: t.Object({
        slug: slugField,
        name,
        code: stateCode,
        isLive: t.Optional(t.Boolean({ description: "Default false" })),
        sortOrder: t.Optional(sortOrderField),
        aliases: t.Optional(aliasesField),
      }),
      detail: { summary: "Create a state", description: "Adds a state or union territory. 422 if the slug or code is already used." + note },
      response: { 201: t.Object({ state: StateSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/admin/states/:id",
    async ({ params }) => {
      const s = await prisma.state.findUnique({ where: { id: params.id } });
      if (!s) throw AppError.notFound("State not found.");
      return { state: toStateDto(s) };
    },
    {
      params: idParam,
      detail: { summary: "Get a state", description: "One state." + note },
      response: { 200: t.Object({ state: StateSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/admin/states/:id",
    async ({ staff, params, body }) => {
      assertNotEmpty(body);
      return { state: await updateState(staff, params.id, body) };
    },
    {
      params: idParam,
      body: t.Object({
        name: t.Optional(name),
        code: t.Optional(stateCode),
        isLive: t.Optional(t.Boolean({ description: "Show this state in menus and counselling pages" })),
        sortOrder: t.Optional(sortOrderField),
        aliases: t.Optional(aliasesField),
      }),
      detail: {
        summary: "Update a state",
        description: "Send only the fields to change. The slug is fixed because it appears in public URLs. States are never deleted: set `isLive` to false to hide one." + note,
      },
      response: { 200: t.Object({ state: StateSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  // ---- countries ----
  .get(
    "/admin/countries",
    async ({ query }) => ({ items: await listCountries({ status: query.status }) }),
    {
      query: t.Object({ status: t.Optional(CountryStatusSchema) }),
      detail: {
        summary: "List countries",
        description: "Study-abroad countries, LIVE ones first, with the number of active country-level NMC notices. Not paginated." + note,
      },
      response: { 200: t.Object({ items: t.Array(CountrySchema) }), ...errorResponses(401, 403, 422) },
    },
  )
  .post(
    "/admin/countries",
    async ({ staff, body, set }) => {
      const country = await createCountry(staff, body);
      set.status = 201;
      return { country };
    },
    {
      body: t.Object({
        slug: slugField,
        name,
        isoCode,
        status: t.Optional(CountryStatusSchema),
        nearIndia: t.Optional(t.Boolean({ description: "Default false" })),
        typicalFlightFromDelhi: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()], { description: "Free text, e.g. `about 5 hours`. Leave empty until verified." })),
        sortOrder: t.Optional(sortOrderField),
        aliases: t.Optional(aliasesField),
      }),
      detail: { summary: "Create a country", description: "Adds a country (default status COMING_SOON). 422 if the slug or ISO code is already used." + note },
      response: { 201: t.Object({ country: CountrySchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/admin/countries/:id",
    async ({ params }) => {
      const c = await prisma.country.findUnique({ where: { id: params.id }, include: { _count: { select: { nmcNotices: { where: { isActive: true } } } } } });
      if (!c) throw AppError.notFound("Country not found.");
      return { country: toCountryDto(c) };
    },
    {
      params: idParam,
      detail: { summary: "Get a country", description: "One country." + note },
      response: { 200: t.Object({ country: CountrySchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/admin/countries/:id",
    async ({ staff, params, body }) => {
      assertNotEmpty(body);
      return { country: await updateCountry(staff, params.id, body) };
    },
    {
      params: idParam,
      body: t.Object({
        name: t.Optional(name),
        isoCode: t.Optional(isoCode),
        status: t.Optional(CountryStatusSchema),
        nearIndia: t.Optional(t.Boolean()),
        typicalFlightFromDelhi: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()], { description: "null or empty clears it" })),
        sortOrder: t.Optional(sortOrderField),
        aliases: t.Optional(aliasesField),
      }),
      detail: {
        summary: "Update a country",
        description: "Send only the fields to change. The slug is fixed because it appears in public URLs. Countries are never deleted: set `status` to COMING_SOON to hide one." + note,
      },
      response: { 200: t.Object({ country: CountrySchema }), ...errorResponses(401, 403, 404, 422) },
    },
  );
