import { Elysia, t } from "elysia";
import { AppError, errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { getAllSettings, getDisclaimerAdminView, publishDisclaimer, updateSetting } from "./site.service";

const note = " Requires role ADMIN. Writes need the `X-BP-Admin: 1` header.";

const SettingItem = t.Object(
  {
    key: t.String({ description: "Setting key, e.g. `contact.phone`", examples: ["finder.freeResultsPerGroup"] }),
    description: t.String(),
    isPublic: t.Boolean({ description: "Exposed through the public GET /site/config" }),
    value: t.Unknown({ description: "Current effective value" }),
    default: t.Unknown({ description: "Value used when no override is stored" }),
    isDefault: t.Boolean({ description: "True when no override is stored" }),
    updatedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
  },
  { description: "A site setting" },
);

const DisclaimerItem = t.Object(
  {
    key: t.String({ examples: ["NOT_GUARANTEED"] }),
    description: t.String(),
    version: t.Integer({ description: "Active version; 0 = built-in default" }),
    text: t.String({ description: "Active text" }),
    isBuiltIn: t.Boolean({ description: "True until an admin publishes the first edited version" }),
    history: t.Array(t.Object({ version: t.Integer(), text: t.String(), createdAt: t.String({ format: "date-time" }) }), {
      description: "All stored versions, newest first",
    }),
  },
  { description: "A versioned legal/disclaimer text" },
);

export const siteAdminRoutes = new Elysia({ tags: ["Admin · Site"] })
  .use(staffGuard({ adminOnly: true }))
  .get(
    "/admin/settings",
    async () => ({ items: await getAllSettings() }),
    {
      detail: { summary: "List site settings", description: "Every known setting with its current value and default." + note },
      response: { 200: t.Object({ items: t.Array(SettingItem) }), ...errorResponses(401, 403) },
    },
  )
  .put(
    "/admin/settings/:key",
    async ({ staff, params, body }) => {
      if (body.value === undefined) throw AppError.invalid("Please fix 1 thing below.", [{ path: "value", message: "A value is required." }]);
      return { item: await updateSetting(staff, params.key, body.value) };
    },
    {
      params: t.Object({ key: t.String({ description: "Setting key from GET /admin/settings" }) }),
      body: t.Object({ value: t.Unknown({ description: "New value; its type depends on the key (string, number or list). Use null to clear a text setting." }) }),
      detail: {
        summary: "Update a site setting",
        description: "Validates the value against that setting's rules, stores it, writes an audit entry and refreshes the public config cache." + note,
      },
      response: { 200: t.Object({ item: SettingItem }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .get(
    "/admin/disclaimers",
    async () => ({ items: await getDisclaimerAdminView() }),
    {
      detail: { summary: "List disclaimers", description: "Each legal text with its active version and full history." + note },
      response: { 200: t.Object({ items: t.Array(DisclaimerItem) }), ...errorResponses(401, 403) },
    },
  )
  .put(
    "/admin/disclaimers/:key",
    async ({ staff, params, body }) => ({ item: await publishDisclaimer(staff, params.key, body.text) }),
    {
      params: t.Object({ key: t.String({ description: "Disclaimer key: NOT_GUARANTEED, FOREIGN_COLLEGES_NMC or ENQUIRY_CONSENT" }) }),
      body: t.Object({ text: t.String({ minLength: 10, maxLength: 2000, description: "The new wording" }) }),
      detail: {
        summary: "Publish a new disclaimer version",
        description: "Never edits in place: adds the next version so earlier wording is kept. 409 if the text is unchanged." + note,
      },
      response: { 200: t.Object({ item: DisclaimerItem }), ...errorResponses(401, 403, 404, 409, 422) },
    },
  );
