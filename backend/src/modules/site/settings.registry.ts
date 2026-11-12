import { t, type TSchema } from "elysia";
import { describeSchema, type JsonSchema } from "../../lib/schema-words";

// Every setting the backend knows about. Staff can change values at runtime (no deploy); the
// registry says what is valid. Unknown keys are rejected. Add new settings here, with a default.
// Business phone/email are null until the owner provides them (PDF §6, §8).

const nullableText = (max: number, extra: Record<string, unknown> = {}) =>
  t.Union([t.String({ minLength: 1, maxLength: max, ...extra }), t.Null()]);

export interface SettingDef {
  key: string;
  description: string;
  /** Exposed by the public `GET /site/config`. Private settings are staff-only. */
  isPublic: boolean;
  schema: TSchema;
  default: unknown;
  /** Plain-words description of a valid value, e.g. "a phone number of 7 to 20 characters". Needed only where the schema alone cannot say (patterns). */
  valueHint?: string;
}

export const SETTINGS: SettingDef[] = [
  { key: "brand.name", description: "Brand name shown across the site. Null until decided.", isPublic: true, schema: nullableText(80), default: null },
  { key: "contact.phone", description: "Business phone number (call + WhatsApp). Null until added.", isPublic: true, schema: nullableText(20, { pattern: "^\\+?[0-9 ()-]{7,20}$" }), default: null, valueHint: "a phone number of 7 to 20 characters, using digits, spaces, + ( ) or -" },
  { key: "contact.whatsapp", description: "WhatsApp number if different from the phone. Null = use the phone.", isPublic: true, schema: nullableText(20, { pattern: "^\\+?[0-9 ()-]{7,20}$" }), default: null, valueHint: "a phone number of 7 to 20 characters, using digits, spaces, + ( ) or -" },
  { key: "contact.email", description: "Business email address. Null until added.", isPublic: true, schema: t.Union([t.String({ format: "email", maxLength: 254 }), t.Null()]), default: null },
  { key: "contact.officeAddress", description: "Office address for the footer and contact page.", isPublic: true, schema: nullableText(300), default: null },
  { key: "contact.callbackHours", description: 'When counsellors call back, e.g. "10am to 7pm, Monday to Saturday".', isPublic: true, schema: nullableText(120), default: null },
  // ---- homepage: hero text and the announcement strip. Edit them together with PUT /admin/site/homepage (which also checks the rules across fields). ----
  { key: "hero.headline", description: "Main headline in the homepage hero. Null = the site's built-in headline.", isPublic: true, schema: nullableText(120), default: null },
  { key: "hero.subtext", description: "Supporting text under the hero headline. Null = the site's built-in text.", isPublic: true, schema: nullableText(300), default: null },
  { key: "announcement.text", description: "Text of the announcement strip at the top of the site.", isPublic: true, schema: nullableText(200), default: null },
  { key: "announcement.linkLabel", description: 'Link text on the strip, e.g. "Know more". Needed when there is a link.', isPublic: true, schema: nullableText(40), default: null },
  { key: "announcement.linkUrl", description: "Where the strip links to: a full https:// address, or a path on this site such as /neet-rank-predictor.", isPublic: true, schema: nullableText(500, { pattern: "^(https?://\\S+|/(?!/)\\S*)$" }), default: null, valueHint: "a full web address starting with http:// or https://, or a path on this site starting with a single / (for example /neet-rank-predictor)" },
  { key: "announcement.isActive", description: "Switch for the announcement strip. Off = hidden, but the text is kept.", isPublic: true, schema: t.Boolean(), default: false },
  { key: "announcement.showFrom", description: "The strip is hidden before this date and time. Null = no start limit.", isPublic: true, schema: t.Union([t.String({ format: "date-time" }), t.Null()]), default: null, valueHint: "a date and time such as 2026-12-01T09:00:00Z" },
  { key: "announcement.showUntil", description: "The strip disappears after this date and time. Null = it stays until switched off.", isPublic: true, schema: t.Union([t.String({ format: "date-time" }), t.Null()]), default: null, valueHint: "a date and time such as 2026-12-31T23:59:00Z" },
  { key: "finder.freeResultsPerGroup", description: "How many India and how many abroad results are shown before a student leaves their details.", isPublic: true, schema: t.Integer({ minimum: 0, maximum: 20 }), default: 2 },
  { key: "finder.stretchPct", description: "A college counts as a stretch if its past closing rank is within this percent beyond the student's likely rank.", isPublic: false, schema: t.Integer({ minimum: 0, maximum: 50 }), default: 15 },
  { key: "enquiry.alertEmails", description: "Counsellor email addresses that receive an alert for every new enquiry.", isPublic: false, schema: t.Array(t.String({ format: "email", maxLength: 254 }), { maxItems: 20 }), default: [] },
  { key: "enquiry.retentionMonths", description: "Enquiries older than this many months are anonymised.", isPublic: false, schema: t.Integer({ minimum: 1, maximum: 120 }), default: 24 },
  { key: "verification.stalenessDays", description: "A college fact not re-checked within this many days is flagged as stale for editors.", isPublic: false, schema: t.Integer({ minimum: 7, maximum: 730 }), default: 90 },
];

// ---- plain-words validation messages ---------------------------------------------------

/**
 * The message shown when a setting value is refused, e.g. "Enter a whole number from 0 to 20."
 * It replaces the validator's own wording ("Expected union value"), which means nothing to staff.
 */
export function describeExpectedValue(def: SettingDef): string {
  const nullable = (def.schema as JsonSchema).anyOf?.some((b) => b.type === "null") ?? false;
  return `Enter ${def.valueHint ?? describeSchema(def.schema as JsonSchema) ?? "a valid value"}.${nullable ? " Leave it empty to clear it." : ""}`;
}

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
