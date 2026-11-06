import { t } from "elysia";
import { AppError } from "../../lib/errors";

// Shared field definitions and normalisers for the reference-data admin API (Phase 2).

export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

export const slugField = t.String({
  minLength: 2,
  maxLength: 60,
  pattern: SLUG_PATTERN,
  description: "Lower-case URL part (letters, digits, single hyphens). Cannot be changed after creation.",
  examples: ["uttar-pradesh"],
});

export const sortOrderField = t.Integer({ minimum: 0, maximum: 9999, description: "Lower numbers come first (default 1000)" });

export const aliasesField = t.Array(t.String({ minLength: 2, maxLength: 40 }), {
  maxItems: 20,
  description: "Alternative spellings the plain-words search should recognise. Stored lower-case, duplicates removed.",
  examples: [["up", "u.p."]],
});

/** http(s) only: these URLs are rendered as links, so `javascript:` and friends must never be stored. */
export const urlField = t.String({
  maxLength: 2000,
  pattern: "^https?://\\S+$",
  description: "Full http(s) link to the official page or document",
  examples: ["https://www.nmc.org.in/"],
});

export const dateInput = t.Union([t.String({ format: "date-time" }), t.String({ format: "date" })], {
  description: "ISO date (`2026-10-01`) or date-time (`2026-10-01T09:30:00Z`)",
});

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((a) => a.trim().toLowerCase()).filter((a) => a.length >= 2))].sort();
}

export function parseUrl(path: string, value: string): string {
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* fall through */
  }
  throw AppError.invalid("Please fix 1 thing below.", [{ path, message: "Enter a full web address starting with http:// or https://." }]);
}

/** Parses a date input and rejects dates in the future (one day of slack for time zones). */
export function parsePastDate(path: string, value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw AppError.invalid("Please fix 1 thing below.", [{ path, message: "Enter a valid date." }]);
  if (d.getTime() > Date.now() + DAY_MS) throw AppError.invalid("Please fix 1 thing below.", [{ path, message: "This date cannot be in the future." }]);
  return d;
}

export function assertNotEmpty(body: object) {
  if (Object.values(body).every((v) => v === undefined)) throw AppError.invalid("Nothing to change. Send at least one field.");
}

/** Trimmed, required text (the length checks in the schema run before trimming, so re-check here). */
export function requiredText(path: string, value: string): string {
  const v = value.trim();
  if (!v) throw AppError.invalid("Please fix 1 thing below.", [{ path, message: "This cannot be empty." }]);
  return v;
}

export function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value.trim() || null;
}

// ---- response schemas ------------------------------------------------------------------

const iso = t.String({ format: "date-time" });

export const StateSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    slug: t.String(),
    name: t.String(),
    code: t.String({ description: "Short code such as `UP`" }),
    isLive: t.Boolean(),
    sortOrder: t.Integer(),
    aliases: t.Array(t.String()),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "An Indian state or union territory" },
);

export const CountryStatusSchema = t.Union([t.Literal("LIVE"), t.Literal("COMING_SOON")], { description: "LIVE = shown with colleges; COMING_SOON = listed but empty" });

export const CountrySchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    slug: t.String(),
    name: t.String(),
    isoCode: t.String({ description: "ISO 3166-1 alpha-2, e.g. `RU`" }),
    status: CountryStatusSchema,
    nearIndia: t.Boolean({ description: "Matches the plain-words search phrase \"near India\"" }),
    typicalFlightFromDelhi: t.Union([t.String(), t.Null()], { description: "Free text, null until verified by staff" }),
    sortOrder: t.Integer(),
    aliases: t.Array(t.String()),
    activeNmcNoticeCount: t.Integer({ description: "Active country-level NMC notices" }),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "A study-abroad country" },
);

export const SourceKindSchema = t.Union(
  [t.Literal("NTA"), t.Literal("MCC"), t.Literal("STATE_COUNSELLING"), t.Literal("NMC"), t.Literal("WDOMS"), t.Literal("COLLEGE_WEBSITE"), t.Literal("OTHER")],
  { description: "Who published the document" },
);

export const SourceSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    kind: SourceKindSchema,
    title: t.String(),
    publisher: t.Union([t.String(), t.Null()]),
    url: t.Union([t.String(), t.Null()]),
    notes: t.Union([t.String(), t.Null()]),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "An official document or page a fact can be traced to" },
);

export const NoticeSeveritySchema = t.Union([t.Literal("ADVISORY"), t.Literal("WARNING")]);
export const NoticeScopeSchema = t.Union([t.Literal("COLLEGE"), t.Literal("COUNTRY")]);

export const NmcNoticeSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    title: t.String(),
    url: t.String(),
    publishedAt: iso,
    severity: NoticeSeveritySchema,
    scope: NoticeScopeSchema,
    country: t.Union([t.Object({ id: t.String({ format: "uuid" }), slug: t.String(), name: t.String() }), t.Null()]),
    collegeId: t.Union([t.String({ format: "uuid" }), t.Null()]),
    isActive: t.Boolean({ description: "Inactive notices no longer raise the NMC alert badge" }),
    checkedAt: iso,
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "An NMC advisory or warning" },
);
