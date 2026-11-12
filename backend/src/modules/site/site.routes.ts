import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { sendCacheable } from "../../lib/http-cache";
import { getPublicSiteConfig } from "./site.service";

const NullableText = (description: string) => t.Union([t.String(), t.Null()], { description });

export const siteRoutes = new Elysia({ prefix: "/site", tags: ["Site"] }).get(
  "/config",
  async (ctx) => sendCacheable(ctx, await getPublicSiteConfig(), { maxAgeSec: 60, staleWhileRevalidateSec: 300 }),
  {
    detail: {
      summary: "Site configuration",
      description:
        "Everything the frontend needs on every page, in one cacheable call: brand name, contact details (null until the owner adds them), " +
        "the finder's free-results count, and the current disclaimer texts. " +
        "Disclaimer `version` 0 means the built-in default is in use. Supports `ETag` / `If-None-Match` (answers 304 with an empty body when unchanged).",
    },
    response: {
      200: t.Object(
        {
          brand: t.Object({ name: NullableText("Brand name, null until decided. The UI shows a placeholder.") }),
          contact: t.Object({
            phone: NullableText("Business phone (call + WhatsApp)"),
            whatsapp: NullableText("WhatsApp number if different from phone"),
            email: NullableText("Business email"),
            officeAddress: NullableText("Office address"),
            callbackHours: NullableText("Counsellor call-back hours"),
          }),
          finder: t.Object({
            freeResultsPerGroup: t.Integer({ description: "India and abroad results shown before the student leaves their details" }),
          }),
          hero: t.Object(
            {
              headline: NullableText("Homepage hero headline. null = use the site's built-in headline."),
              subtext: NullableText("Text under the hero headline. null = use the site's built-in text."),
            },
            { description: "Homepage hero text, editable by an admin" },
          ),
          announcement: t.Union(
            [
              t.Object({
                id: t.String({ description: "Changes whenever the wording or link changes. Use it to remember that a visitor dismissed THIS announcement." }),
                text: t.String(),
                linkLabel: NullableText("Link text, null when the strip has no link"),
                linkUrl: NullableText("A full https:// address or a path on this site (starts with /); null when the strip has no link"),
              }),
              t.Null(),
            ],
            { description: "The announcement strip to show right now, or null when there is none (off, scheduled, expired or empty)" },
          ),
          disclaimers: t.Record(
            t.String({ description: "Disclaimer key: NOT_GUARANTEED, FOREIGN_COLLEGES_NMC, ENQUIRY_CONSENT" }),
            t.Object({
              version: t.Integer({ description: "0 = built-in default" }),
              text: t.String({ description: "The wording to show, exactly as written" }),
            }),
            { description: "Current disclaimer texts by key" },
          ),
        },
        { description: "Public site configuration" },
      ),
      ...errorResponses(429),
    },
  },
);
