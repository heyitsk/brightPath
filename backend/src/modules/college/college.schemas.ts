import type { TSchema } from "@sinclair/typebox";
import { t } from "elysia";
import { AppError, type FieldError } from "../../lib/errors";
import { dateInput, urlField } from "../reference/reference.schemas";

// Request and response shapes for the college admin API (Phase 4b). Field names and meanings are the contract the frontend builds on.

const iso = t.String({ format: "date-time" });
const uuid = t.String({ format: "uuid" });
const nullable = <T extends TSchema>(s: T) => t.Union([s, t.Null()]);

export const CollegeKindSchema = t.Union([t.Literal("INDIA"), t.Literal("ABROAD")], { description: "INDIA = Indian college (one page layout), ABROAD = foreign college (the other layout)" });
export const CollegeStatusSchema = t.Union([t.Literal("DRAFT"), t.Literal("READY"), t.Literal("ARCHIVED")], {
  description: "DRAFT = being prepared, not public. READY = live on the site. ARCHIVED = taken down but kept.",
});
export const OwnershipSchema = t.Union([t.Literal("GOVERNMENT"), t.Literal("PRIVATE"), t.Literal("DEEMED"), t.Literal("TRUST")]);
export const WdomsStatusSchema = t.Union([t.Literal("LISTED"), t.Literal("NOT_LISTED"), t.Literal("UNKNOWN")], { description: "UNKNOWN = not checked yet (blocks Mark ready)" });
export const LocationBasisSchema = t.Union([t.Literal("WELL_KNOWN"), t.Literal("IN_COLLEGE_NAME"), t.Literal("CHECKED_ONLINE")], {
  description: "How the city was confirmed in the starting list. Staff-only.",
});
export const SourcePurposeSchema = t.Union(
  [t.Literal("WDOMS"), t.Literal("FEE_NOTICE"), t.Literal("NMC_NOTICES"), t.Literal("NMC_RECOGNITION"), t.Literal("SEAT_LIST"), t.Literal("COUNSELLING"), t.Literal("COLLEGE_WEBSITE"), t.Literal("OTHER")],
  { description: "What the source is evidence for" },
);

const text = (max: number, description?: string) => t.String({ maxLength: max, ...(description ? { description } : {}) });
const nullableText = (max: number, description: string) => t.Union([text(max), t.Null()], { description });
const nullableInt = (min: number, max: number, description: string) => t.Union([t.Integer({ minimum: min, maximum: max }), t.Null()], { description });

// ---- request bodies --------------------------------------------------------------------

export const IndiaProfileInput = t.Object(
  {
    nmcRecognised: t.Optional(t.Union([t.Boolean(), t.Null()], { description: "Recognised by NMC? null = not checked yet" })),
    nmcRecognitionCheckedAt: t.Optional(t.Union([dateInput, t.Null()], { description: "When NMC recognition was last checked (not in the future)" })),
    mbbsSeats: t.Optional(nullableInt(1, 2000, "Number of MBBS seats")),
    hospitalName: t.Optional(nullableText(200, "Attached teaching hospital")),
    hospitalBeds: t.Optional(nullableInt(0, 20000, "Beds in the attached hospital")),
    dailyOutpatients: t.Optional(nullableInt(0, 100000, "Average outpatients per day")),
    serviceBondYears: t.Optional(nullableInt(0, 20, "Years of compulsory service, 0 or null if none")),
    serviceBondPenaltyInr: t.Optional(nullableInt(0, 100000000, "Penalty in rupees for breaking the bond")),
    stipendInr: t.Optional(nullableInt(0, 1000000, "Monthly internship stipend in rupees")),
    domicileRule: t.Optional(nullableText(500, "Who qualifies for state-quota seats, in plain words")),
  },
  { description: "Facts that only Indian colleges have. Send only the fields to change." },
);

export const AbroadProfileInput = t.Object(
  {
    wdomsListed: t.Optional(WdomsStatusSchema),
    wdomsId: t.Optional(nullableText(60, "ID in the WDOMS directory")),
    wdomsUrl: t.Optional(t.Union([urlField, t.Null()], { description: "Link to the WDOMS entry" })),
    wdomsCheckedAt: t.Optional(t.Union([dateInput, t.Null()], { description: "When WDOMS was last checked (not in the future)" })),
    internshipMonths: t.Optional(nullableInt(0, 60, "Length of the internship in months")),
    teachingLanguage: t.Optional(nullableText(80, "Language of teaching, e.g. `English`")),
    languageNote: t.Optional(nullableText(300, 'e.g. "Russian from year 3"')),
    intakeMonths: t.Optional(t.Array(t.Integer({ minimum: 1, maximum: 12 }), { maxItems: 12, description: "Months of the year when admissions open (1 to 12). Duplicates are removed." })),
    seatsForIndians: t.Optional(nullableInt(0, 5000, "Seats open to Indian students")),
    nmcLengthOk: t.Optional(t.Union([t.Boolean(), t.Null()], { description: "Does the course length meet the NMC 2021 rule? null = not checked" })),
    nmcEnglishOk: t.Optional(t.Union([t.Boolean(), t.Null()], { description: "Is teaching in English, as the NMC 2021 rule needs? null = not checked" })),
    nmcInternshipOk: t.Optional(t.Union([t.Boolean(), t.Null()], { description: "Does the internship meet the NMC 2021 rule? null = not checked" })),
    nmcCheckedAt: t.Optional(t.Union([dateInput, t.Null()], { description: "When the NMC 2021 answers were checked (not in the future)" })),
    eligibility: t.Optional(
      t.Union([t.Record(t.String({ maxLength: 60 }), t.String({ maxLength: 300 }), { maxProperties: 20 }), t.Null()], {
        description: 'Plain-words eligibility rules by name, e.g. `{ "Age": "17 by 31 December", "Class 12 PCB": "50% (40% for SC/ST/OBC)" }`',
      }),
    ),
    documents: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 120 }), { maxItems: 30, description: "Documents needed to apply" })),
  },
  { description: "Facts that only foreign colleges have. Send only the fields to change." },
);

const baseFields = {
  shortName: t.Optional(nullableText(60, "Short name or abbreviation")),
  ownership: t.Optional(t.Union([OwnershipSchema, t.Null()])),
  establishedYear: t.Optional(nullableInt(1500, new Date().getFullYear(), "Year the college was founded")),
  courseLengthMonths: t.Optional(nullableInt(12, 144, "Whole course length in months, internship included. Decides how many fee years are needed (rounded up).")),
  description: t.Optional(nullableText(5000, "Written in our own words, never copied from another site")),
  heroImageUrl: t.Optional(t.Union([urlField, t.Null()])),
  websiteUrl: t.Optional(t.Union([urlField, t.Null()], { description: "The college's own website" })),
  internalNotes: t.Optional(nullableText(2000, "Staff-only notes, never shown publicly")),
};

export const CreateCollegeBody = t.Object(
  {
    kind: CollegeKindSchema,
    name: t.String({ minLength: 1, maxLength: 200 }),
    city: t.String({ minLength: 1, maxLength: 100 }),
    stateId: t.Optional(t.Union([uuid, t.Null()], { description: "Required in practice for INDIA colleges; not allowed for ABROAD" })),
    countryId: t.Optional(t.Union([uuid, t.Null()], { description: "Required in practice for ABROAD colleges; not allowed for INDIA" })),
    ...baseFields,
    india: t.Optional(IndiaProfileInput),
    abroad: t.Optional(AbroadProfileInput),
  },
  { additionalProperties: false, description: "A new college is always saved as a DRAFT. The web address is made from the name and cannot change later." },
);

export const UpdateCollegeBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    city: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
    stateId: t.Optional(t.Union([uuid, t.Null()])),
    countryId: t.Optional(t.Union([uuid, t.Null()])),
    ...baseFields,
    india: t.Optional(IndiaProfileInput),
    abroad: t.Optional(AbroadProfileInput),
  },
  { additionalProperties: false, description: "Send only the fields to change. `null` clears an optional field. Slug, kind and status cannot be changed here (status has its own actions)." },
);

export const FeeLineBody = t.Object(
  {
    tuition: t.Number({ minimum: 0, maximum: 99_999_999_999, description: "Tuition for the year, in `currency`. At most 2 decimals. 0 is allowed." }),
    hostel: t.Optional(t.Number({ minimum: 0, maximum: 99_999_999_999, description: "Hostel and food for the year (default 0)" })),
    other: t.Optional(t.Number({ minimum: 0, maximum: 99_999_999_999, description: "Everything else for the year, e.g. insurance, visa, registration (default 0)" })),
    currency: t.String({ pattern: "^[A-Za-z]{3}$", description: "3-letter currency code such as `USD`, `RUB` or `INR` (stored upper-case)" }),
    sourceId: t.Union([uuid, t.Null()], { description: "The source the figures come from. Required before Mark ready." }),
    checkedAt: t.Optional(t.Union([dateInput, t.Null()], { description: "When the figures were last checked (default today)" })),
  },
  { description: "One year of fees. Saving a year that already exists replaces it." },
);

export const SourceLinkBody = t.Object({
  sourceId: uuid,
  purpose: SourcePurposeSchema,
  checkedAt: dateInput,
});

export const FaqsBody = t.Object({
  items: t.Array(t.Object({ question: t.String({ minLength: 1, maxLength: 300 }), answer: t.String({ minLength: 1, maxLength: 3000 }) }), {
    maxItems: 40,
    description: "The full list, in display order. Replaces the existing FAQs.",
  }),
});

// ---- responses -------------------------------------------------------------------------

const Ref = t.Object({ id: uuid, slug: t.String(), name: t.String() });
const StateRef = t.Object({ id: uuid, slug: t.String(), name: t.String(), code: t.String() });

export const MissingSchema = t.Object(
  {
    path: t.String({ description: "Which field to highlight, e.g. `name`, `fees`, `fees.2.sourceId`, `abroad.wdomsCheckedAt`" }),
    message: t.String({ description: "What to do, in plain words" }),
  },
  { description: "One required detail that is still missing" },
);

export const ReadinessSchema = t.Object(
  {
    canMarkReady: t.Boolean({ description: "True when nothing is missing" }),
    missing: t.Array(MissingSchema),
    feeYearsRequired: nullable(t.Integer({ description: "Fee rows needed (course length / 12, rounded up); null while the course length is unknown" })),
    feeYearsFilled: t.Integer(),
  },
  { description: "Whether Mark ready would be accepted, and if not, everything that is missing" },
);

export const CollegeSummarySchema = t.Object(
  {
    id: uuid,
    slug: t.String({ description: "Public address is `/colleges/<slug>`" }),
    kind: CollegeKindSchema,
    name: t.String(),
    city: t.String(),
    status: CollegeStatusSchema,
    ownership: nullable(OwnershipSchema),
    country: nullable(Ref),
    state: nullable(StateRef),
    courseLengthMonths: nullable(t.Integer()),
    totalCourseFeeInr: nullable(t.Integer({ description: "Whole-course fee in rupees at today's exchange rates; null until every year has fees and a rate" })),
    readiness: t.Object({ canMarkReady: t.Boolean(), missingCount: t.Integer(), feeYearsRequired: nullable(t.Integer()), feeYearsFilled: t.Integer() }),
    readyAt: nullable(iso),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "A college as shown in the admin list" },
);

export const FeeLineSchema = t.Object(
  {
    yearNumber: t.Integer({ description: "1 = first year of the course" }),
    tuition: t.Number(),
    hostel: t.Number(),
    other: t.Number(),
    currency: t.String(),
    totalLocal: t.Number({ description: "tuition + hostel + other, in `currency`" }),
    rateToInr: nullable(t.Number({ description: "Rupees per unit of `currency` right now; 1 for INR; null if no rate is on file" })),
    totalInr: nullable(t.Integer({ description: "totalLocal converted at today's rate, rounded to whole rupees; null if no rate" })),
    source: nullable(t.Object({ id: uuid, title: t.String(), url: nullable(t.String()) })),
    checkedAt: nullable(iso),
  },
  { description: "One year of fees" },
);

export const SourceLinkSchema = t.Object({
  id: uuid,
  purpose: SourcePurposeSchema,
  checkedAt: iso,
  source: t.Object({ id: uuid, kind: t.String(), title: t.String(), url: nullable(t.String()) }),
});

export const CollegeDetailSchema = t.Object(
  {
    id: uuid,
    slug: t.String(),
    kind: CollegeKindSchema,
    name: t.String(),
    shortName: nullable(t.String()),
    city: t.String(),
    status: CollegeStatusSchema,
    country: nullable(Ref),
    state: nullable(StateRef),
    ownership: nullable(OwnershipSchema),
    establishedYear: nullable(t.Integer()),
    courseLengthMonths: nullable(t.Integer()),
    description: nullable(t.String()),
    heroImageUrl: nullable(t.String()),
    websiteUrl: nullable(t.String()),
    internalNotes: nullable(t.String()),
    locationBasis: nullable(LocationBasisSchema),
    importBatchId: nullable(uuid),
    totalCourseFeeInr: nullable(t.Integer()),
    totalFeeCalculatedAt: nullable(iso),
    readyAt: nullable(iso),
    createdAt: iso,
    updatedAt: iso,
    india: nullable(
      t.Object({
        nmcRecognised: nullable(t.Boolean()),
        nmcRecognitionCheckedAt: nullable(iso),
        mbbsSeats: nullable(t.Integer()),
        hospitalName: nullable(t.String()),
        hospitalBeds: nullable(t.Integer()),
        dailyOutpatients: nullable(t.Integer()),
        serviceBondYears: nullable(t.Integer()),
        serviceBondPenaltyInr: nullable(t.Integer()),
        stipendInr: nullable(t.Integer()),
        domicileRule: nullable(t.String()),
      }),
    ),
    abroad: nullable(
      t.Object({
        wdomsListed: WdomsStatusSchema,
        wdomsId: nullable(t.String()),
        wdomsUrl: nullable(t.String()),
        wdomsCheckedAt: nullable(iso),
        internshipMonths: nullable(t.Integer()),
        teachingLanguage: nullable(t.String()),
        languageNote: nullable(t.String()),
        intakeMonths: t.Array(t.Integer()),
        seatsForIndians: nullable(t.Integer()),
        nmcLengthOk: nullable(t.Boolean()),
        nmcEnglishOk: nullable(t.Boolean()),
        nmcInternshipOk: nullable(t.Boolean()),
        nmcCheckedAt: nullable(iso),
        meetsNmc2021: t.Union([t.Literal("MEETS"), t.Literal("DOES_NOT_MEET"), t.Literal("UNKNOWN")], {
          description: "Worked out from the three NMC answers: MEETS if all true, DOES_NOT_MEET if any false, otherwise UNKNOWN",
        }),
        eligibility: nullable(t.Record(t.String(), t.String())),
        documents: t.Array(t.String()),
      }),
    ),
    fees: t.Array(FeeLineSchema, { description: "One row per course year, year 1 first" }),
    sources: t.Array(SourceLinkSchema),
    faqs: t.Array(t.Object({ question: t.String(), answer: t.String() })),
    readiness: ReadinessSchema,
  },
  { description: "Everything about one college, as the admin edit screen needs it" },
);

// ---- unknown-field check ---------------------------------------------------------------

const FIXED_FIELDS: Record<string, string> = {
  slug: "The web address is made from the name when the college is created and cannot be changed.",
  kind: "A college's kind (India or abroad) cannot be changed. Create a new college instead.",
  status: "Status is changed with the Mark ready, Move to draft and Archive actions, not by editing the college.",
  readyAt: "The live date is set by Mark ready.",
  totalCourseFeeInr: "The rupee total is worked out from the fee table and exchange rates.",
};

/**
 * Elysia silently drops fields a schema does not list. For these routes that would hide mistakes (an editor sending `slug` or
 * `status` believing it worked), so unknown fields are refused with a message that says why. Runs in the route's `transform` hook,
 * before Elysia cleans the body. Checks nested objects (`india`, `abroad`) too.
 */
export function rejectUnknownFields(body: unknown, schema: TSchema, prefix = ""): void {
  const errors: FieldError[] = [];
  collectUnknown(body, schema, prefix, errors);
  if (errors.length) throw AppError.invalid(errors.length === 1 ? "Please fix 1 thing below." : `Please fix ${errors.length} things below.`, errors);
}

function collectUnknown(body: unknown, schema: TSchema, prefix: string, out: FieldError[]) {
  const props = (schema as { properties?: Record<string, TSchema> }).properties;
  if (!props || !body || typeof body !== "object" || Array.isArray(body)) return;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const path = prefix + key;
    if (!(key in props)) out.push({ path, message: (!prefix && FIXED_FIELDS[key]) || "This field is not recognised here." });
    else collectUnknown(value, props[key]!, `${path}.`, out);
  }
}
