import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { dateInput } from "../reference/reference.schemas";
import { deleteRate, listRates, setRates } from "./fx.service";

const note = " Requires role EDITOR or ADMIN. Writes need the `X-BP-Admin: 1` header.";
const iso = t.String({ format: "date-time" });
const currencyParam = t.Object({ currency: t.String({ pattern: "^[A-Za-z]{3}$", description: "3-letter currency code, e.g. `USD` (any case)" }) });

const rateFields = {
  rateToInr: t.Number({ minimum: 0.000001, maximum: 100_000_000, description: "How many rupees one unit of the currency buys (e.g. `88.5` for USD). At most 6 decimals." }),
  asOf: dateInput,
  sourceNote: t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()], { description: "Where the rate was read from, e.g. `RBI reference rate`" })),
};
const confirmField = t.Optional(
  t.Boolean({ description: "Set true to accept a change of more than 20% from the current rate. Without it such a change is refused, to catch a slipped decimal point." }),
);

const RateSchema = t.Object(
  {
    currency: t.String(),
    rateToInr: t.Number(),
    asOf: t.String({ format: "date", description: "The date the rate was read, `YYYY-MM-DD`" }),
    sourceNote: t.Union([t.String(), t.Null()]),
    updatedAt: iso,
  },
  { description: "One stored exchange rate" },
);

const RateRowSchema = t.Object(
  {
    currency: t.String(),
    hasRate: t.Boolean({ description: "False when colleges charge fees in this currency but no rate has been entered yet" }),
    rateToInr: t.Union([t.Number(), t.Null()]),
    asOf: t.Union([t.String({ format: "date" }), t.Null()]),
    sourceNote: t.Union([t.String(), t.Null()]),
    updatedAt: t.Union([iso, t.Null()]),
    collegesUsing: t.Integer({ description: "Colleges with at least one fee row in this currency" }),
    liveCollegesUsing: t.Integer({ description: "Of those, how many are live (READY)" }),
  },
  { description: "A currency as shown on the Exchange rates page" },
);

const Effect = {
  collegesUsing: t.Integer({ description: "Colleges that charge fees in the changed currency or currencies" }),
  collegesRecalculated: t.Integer({ description: "Colleges whose rupee total actually changed" }),
};

export const fxAdminRoutes = new Elysia({ tags: ["Admin · Exchange rates"] })
  .use(staffGuard({ roles: ["EDITOR"] }))
  .get("/admin/fx-rates", () => listRates(), {
    detail: {
      summary: "List exchange rates",
      description:
        "The whole Exchange rates page in one call: every currency that has a rate, plus any currency colleges already charge in but that has no rate yet (`hasRate: false`, listed first). `missingCount` is how many of those need attention. INR is never listed (it is always 1)." + note,
    },
    response: { 200: t.Object({ items: t.Array(RateRowSchema), missingCount: t.Integer() }), ...errorResponses(401, 403) },
  })
  .put(
    "/admin/fx-rates/:currency",
    async ({ staff, params, body }) => {
      const r = await setRates(staff, [{ currency: params.currency, ...body }], body.confirmLargeChange ?? false);
      return { rate: r.rates[0]!, collegesUsing: r.collegesUsing, collegesRecalculated: r.collegesRecalculated };
    },
    {
      params: currencyParam,
      body: t.Object({ ...rateFields, confirmLargeChange: confirmField }),
      detail: {
        summary: "Set an exchange rate",
        description:
          "Creates or replaces the rate for one currency. Every college that charges fees in it gets its rupee total recalculated in the same step, so the whole site updates at once; the response says how many. `asOf` is the date the rate was read (not in the future). A change of more than 20% from the current rate is refused unless `confirmLargeChange` is true. INR cannot have a rate." + note,
      },
      response: { 200: t.Object({ rate: RateSchema, ...Effect }), ...errorResponses(401, 403, 422) },
    },
  )
  .put(
    "/admin/fx-rates",
    async ({ staff, body }) => setRates(staff, body.items, body.confirmLargeChange ?? false),
    {
      body: t.Object({
        items: t.Array(t.Object({ currency: t.String({ minLength: 1, maxLength: 3 }), ...rateFields }), { minItems: 1, maxItems: 50 }),
        confirmLargeChange: confirmField,
      }),
      detail: {
        summary: "Set several exchange rates at once",
        description:
          "For a 'Save all' button. All rates are checked first and saved together, or none are: a problem names its row (`items.2.rateToInr`). Each currency may appear once. The same 20% safeguard applies per row." + note,
      },
      response: { 200: t.Object({ rates: t.Array(RateSchema), ...Effect }), ...errorResponses(401, 403, 422) },
    },
  )
  .delete(
    "/admin/fx-rates/:currency",
    async ({ staff, params }) => ({ ok: true as const, ...(await deleteRate(staff, params.currency)) }),
    {
      params: currencyParam,
      detail: {
        summary: "Remove an exchange rate",
        description:
          "Draft colleges that use the currency lose their rupee total until a rate is set again. Refused with 409 while any live college charges fees in that currency, because it would leave that college incomplete. Audited." + note,
      },
      response: { 200: t.Object({ ok: t.Literal(true), ...Effect }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  );
