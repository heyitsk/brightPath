import { Elysia, t } from "elysia";
import { AppError, errorResponses } from "../../lib/errors";
import { staffGuard } from "../../plugins/auth";
import { rejectUnknownFields } from "../college/college.schemas";
import { getAllSettings, getDisclaimerAdminView, getHomepage, publishDisclaimer, updateHomepage, updateSetting } from "./site.service";

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


const NullableString = (max: number, description: string) => t.Union([t.String({ maxLength: max }), t.Null()], { description });
const HomepageSchema = t.Object(
  {
    hero: t.Object({ headline: t.Union([t.String(), t.Null()]), subtext: t.Union([t.String(), t.Null()]) }, { description: "null = the site shows its built-in text" }),
    announcement: t.Object(
      {
        text: t.Union([t.String(), t.Null()]),
        linkLabel: t.Union([t.String(), t.Null()]),
        linkUrl: t.Union([t.String(), t.Null()]),
        isActive: t.Boolean({ description: "The on/off switch" }),
        showFrom: t.Union([t.String({ format: "date-time" }), t.Null()]),
        showUntil: t.Union([t.String({ format: "date-time" }), t.Null()]),
        status: t.Union([t.Literal("OFF"), t.Literal("EMPTY"), t.Literal("SCHEDULED"), t.Literal("LIVE"), t.Literal("EXPIRED")], {
          description: "LIVE = visitors see it now. OFF = switched off. SCHEDULED = waiting for showFrom. EXPIRED = showUntil has passed. EMPTY = switched on but no text.",
        }),
        id: t.Union([t.String(), t.Null()], { description: "What visitors' dismiss-memory is keyed on; changes when the wording or link changes" }),
      },
      { description: "The announcement strip" },
    ),
  },
  { description: "Homepage hero text and announcement strip, as set (not just what is live)" },
);
const HomepagePatchBody = t.Object({
  hero: t.Optional(t.Object({ headline: t.Optional(NullableString(120, "Up to 120 characters")), subtext: t.Optional(NullableString(300, "Up to 300 characters")) })),
  announcement: t.Optional(
    t.Object({
      text: t.Optional(NullableString(200, "Up to 200 characters")),
      linkLabel: t.Optional(NullableString(40, 'Up to 40 characters, e.g. "Know more"')),
      linkUrl: t.Optional(NullableString(500, "A full https:// address, or a path on this site starting with a single /")),
      isActive: t.Optional(t.Boolean()),
      showFrom: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()], { description: "Hidden before this time. null = no start limit." })),
      showUntil: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()], { description: "Disappears after this time. null = stays until switched off." })),
    }),
  ),
});

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
    "/admin/site/homepage",
    async () => getHomepage(),
    {
      detail: {
        summary: "Get homepage hero text and announcement strip",
        description:
          "The hero headline and text, and the announcement strip with its switch, link, optional start and end time, and `status` (is it showing right now?). `null` hero text means the site shows its built-in wording." + note,
      },
      response: { 200: HomepageSchema, ...errorResponses(401, 403) },
    },
  )
  .patch(
    "/admin/site/homepage",
    async ({ staff, body }) => updateHomepage(staff, body),
    {
      transform: ({ body }) => rejectUnknownFields(body, HomepagePatchBody),
      body: HomepagePatchBody,
      detail: {
        summary: "Edit homepage hero text and announcement strip",
        description:
          "Send only what changes, under `hero` and/or `announcement`; empty text or `null` clears a field. All the changes are saved together or not at all, and take effect on the public site straight away (`GET /site/config`). " +
          "Checks beyond each field: the strip cannot be switched on without text; a link needs both its text and its address; `showUntil` must be after `showFrom`. " +
          "`linkUrl` is a full https:// address or a path on this site starting with a single `/`. Each changed field is audited." + note,
      },
      response: { 200: HomepageSchema, ...errorResponses(401, 403, 422) },
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
