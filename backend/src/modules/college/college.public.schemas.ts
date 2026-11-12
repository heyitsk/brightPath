import type { TSchema } from "@sinclair/typebox";
import { t } from "elysia";

// Public college shapes (Phase 4e). Only what is safe and useful to show: no staff notes, no import metadata, no internal status.

const iso = t.String({ format: "date-time" });
const nullable = <T extends TSchema>(s: T) => t.Union([s, t.Null()]);

export const PublicOwnershipSchema = t.Union([t.Literal("GOVERNMENT"), t.Literal("PRIVATE"), t.Literal("DEEMED"), t.Literal("TRUST")]);
export const NmcAlertSchema = t.Union([t.Literal("NONE"), t.Literal("ADVISORY"), t.Literal("WARNING")], {
  description: "Highest severity among the active NMC notices that apply to the college (its own, or its country's). NONE = no active notice.",
});

const CountryRef = t.Object({ slug: t.String(), name: t.String() });
const StateRef = t.Object({ slug: t.String(), name: t.String(), code: t.String() });

export const CollegeCardSchema = t.Object(
  {
    slug: t.String({ description: "The page is `/colleges/<slug>`" }),
    kind: t.Union([t.Literal("INDIA"), t.Literal("ABROAD")], { description: "Decides which page layout to use" }),
    name: t.String(),
    shortName: nullable(t.String()),
    city: t.String(),
    country: nullable(CountryRef),
    state: nullable(StateRef),
    ownership: nullable(PublicOwnershipSchema),
    establishedYear: nullable(t.Integer()),
    heroImageUrl: nullable(t.String()),
    courseLengthMonths: nullable(t.Integer()),
    totalCourseFeeInr: nullable(t.Integer({ description: "Whole-course fee in rupees at the current exchange rates" })),
    badges: t.Object(
      {
        nmcAlert: NmcAlertSchema,
        nmcRecognised: nullable(t.Boolean({ description: "INDIA colleges: recognised by NMC. null for foreign colleges." })),
        wdomsListed: nullable(t.Union([t.Literal("LISTED"), t.Literal("NOT_LISTED"), t.Literal("UNKNOWN")], { description: "ABROAD colleges: listed in WDOMS. null for Indian colleges." })),
        meetsNmc2021: nullable(t.Union([t.Literal("MEETS"), t.Literal("DOES_NOT_MEET"), t.Literal("UNKNOWN")], { description: "ABROAD colleges: NMC 2021 rules. null for Indian colleges." })),
      },
      { description: "The coloured chips on a college card" },
    ),
    dataCheckedAt: nullable(
      t.String({ format: "date-time", description: "The OLDEST check date among the facts shown, so this never overstates how fresh the data is" }),
    ),
  },
  { description: "A college as shown on a card or in a list" },
);

const Count = (extra: Record<string, TSchema>) => t.Object({ ...extra, count: t.Integer() });

export const CollegeListSchema = t.Object({
  items: t.Array(CollegeCardSchema),
  total: t.Integer({ description: "Colleges matching the filters, across all pages" }),
  page: t.Integer(),
  pageSize: t.Integer(),
  totalPages: t.Integer(),
  facets: t.Object(
    {
      countries: t.Array(Count({ slug: t.String(), name: t.String() })),
      states: t.Array(Count({ slug: t.String(), name: t.String(), code: t.String() })),
      ownership: t.Array(Count({ value: PublicOwnershipSchema })),
      totalFeeInr: t.Object({ min: nullable(t.Integer()), max: nullable(t.Integer()) }, { description: "Cheapest and dearest whole-course fee among all listed colleges, for a budget slider" }),
    },
    { description: "Filter options with counts, computed over ALL listed colleges (not narrowed by the current filters, so the options do not jump around)" },
  ),
});

export const PublicFeeSchema = t.Object({
  yearNumber: t.Integer({ description: "1 = first year" }),
  tuition: t.Number(),
  hostel: t.Number(),
  other: t.Number(),
  currency: t.String(),
  totalLocal: t.Number({ description: "tuition + hostel + other, in `currency`" }),
  rateToInr: t.Number({ description: "Rupees per unit of `currency` used for the conversion (1 for INR)" }),
  totalInr: t.Integer({ description: "totalLocal in whole rupees" }),
  source: nullable(t.Object({ title: t.String(), url: nullable(t.String()) })),
  checkedAt: nullable(iso),
});

export const PublicNoticeSchema = t.Object({
  title: t.String(),
  url: t.String(),
  publishedAt: iso,
  severity: t.Union([t.Literal("ADVISORY"), t.Literal("WARNING")]),
  scope: t.Union([t.Literal("COLLEGE"), t.Literal("COUNTRY")], { description: "COLLEGE = about this college; COUNTRY = applies to every college in its country" }),
  checkedAt: iso,
});

export const CollegePageSchema = t.Object(
  {
    slug: t.String(),
    kind: t.Union([t.Literal("INDIA"), t.Literal("ABROAD")]),
    name: t.String(),
    shortName: nullable(t.String()),
    city: t.String(),
    country: nullable(t.Object({ slug: t.String(), name: t.String(), typicalFlightFromDelhi: nullable(t.String()) })),
    state: nullable(StateRef),
    ownership: nullable(PublicOwnershipSchema),
    establishedYear: nullable(t.Integer()),
    courseLengthMonths: nullable(t.Integer()),
    description: nullable(t.String()),
    heroImageUrl: nullable(t.String()),
    websiteUrl: nullable(t.String()),
    totalCourseFeeInr: nullable(t.Integer()),
    feeRatesAsOf: nullable(t.String({ format: "date", description: "The oldest exchange-rate date among the currencies used; null if every fee is in INR. Show next to converted amounts." })),
    fees: t.Array(PublicFeeSchema, { description: "Fees, year by year" }),
    india: nullable(
      t.Object({
        nmcRecognised: nullable(t.Boolean()),
        nmcRecognitionCheckedAt: nullable(iso),
        mbbsSeats: nullable(t.Integer()),
        hospital: t.Object({ name: nullable(t.String()), beds: nullable(t.Integer()), dailyOutpatients: nullable(t.Integer()) }),
        serviceBond: nullable(t.Object({ years: t.Integer(), penaltyInr: nullable(t.Integer()) }, { description: "null when there is no bond" })),
        stipendInr: nullable(t.Integer({ description: "Monthly internship stipend" })),
        domicileRule: nullable(t.String()),
      }),
    ),
    abroad: nullable(
      t.Object({
        wdoms: t.Object({ status: t.Union([t.Literal("LISTED"), t.Literal("NOT_LISTED"), t.Literal("UNKNOWN")]), id: nullable(t.String()), url: nullable(t.String()), checkedAt: nullable(iso) }),
        nmc2021: t.Object({
          status: t.Union([t.Literal("MEETS"), t.Literal("DOES_NOT_MEET"), t.Literal("UNKNOWN")]),
          lengthOk: nullable(t.Boolean()),
          englishOk: nullable(t.Boolean()),
          internshipOk: nullable(t.Boolean()),
          checkedAt: nullable(iso),
        }),
        teachingLanguage: nullable(t.String()),
        languageNote: nullable(t.String()),
        internshipMonths: nullable(t.Integer()),
        intakeMonths: t.Array(t.Integer({ description: "1 to 12" })),
        seatsForIndians: nullable(t.Integer()),
        eligibility: nullable(t.Record(t.String(), t.String())),
        documents: t.Array(t.String()),
      }),
    ),
    nmc: t.Object(
      {
        alert: NmcAlertSchema,
        notices: t.Array(PublicNoticeSchema, { description: "Active notices, newest first. Show them in red when `alert` is not NONE." }),
        checkedAt: nullable(iso),
      },
      { description: "`checkedAt`: when the NMC position was last checked, for the \"No NMC alert found\" chip" },
    ),
    sources: t.Array(
      t.Object({ purpose: t.String(), title: t.String(), publisher: nullable(t.String()), url: nullable(t.String()), checkedAt: iso }),
      { description: "\"Sources and dates\"" },
    ),
    dataCheckedAt: nullable(iso),
    faqs: t.Array(t.Object({ question: t.String(), answer: t.String() })),
    nearby: t.Array(CollegeCardSchema, { description: "Up to 4 other listed colleges in the same city, then the same state or country" }),
    updatedAt: iso,
  },
  { description: "Everything a college page shows. The `kind` decides the layout and whether `india` or `abroad` is filled." },
);
