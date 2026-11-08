import { t } from "elysia";
import { SCORE_MAX, SCORE_MIN } from "./rank-engine";

const iso = t.String({ format: "date-time" });
const nullable = <T extends ReturnType<typeof t.String>>(s: T) => t.Union([s, t.Null()]);

// ---- shared field types ----------------------------------------------------------------

export const CategorySchema = t.Union([t.Literal("GENERAL"), t.Literal("EWS"), t.Literal("OBC"), t.Literal("SC"), t.Literal("ST")], {
  description: "The student's reservation category. `GENERAL` is the unreserved (UR) category.",
});

export const GroupSchema = t.Union(
  [t.Literal("OVERALL"), t.Literal("GENERAL"), t.Literal("EWS"), t.Literal("OBC"), t.Literal("SC"), t.Literal("ST"), t.Literal("PWD")],
  { description: "OVERALL = the All-India list; PWD = the PwD list; the rest are categories" },
);

export const CutoffGroupSchema = t.Union(
  [t.Literal("GENERAL"), t.Literal("EWS"), t.Literal("OBC"), t.Literal("SC"), t.Literal("ST"), t.Literal("PWD")],
  { description: "Group a qualifying cut-off applies to" },
);

export const BasisSchema = t.Union([t.Literal("EXACT_TIES"), t.Literal("BAND_INTERPOLATION")], {
  description:
    "How ranks were derived. EXACT_TIES: NTA data has a count for every score, so ranks are exact ranges of tied students. " +
    "BAND_INTERPOLATION: some counts cover mark ranges, so ranks inside a range are estimates.",
});

export const scoreField = t.Integer({
  minimum: SCORE_MIN,
  maximum: SCORE_MAX,
  description: `NEET (UG) marks, a whole number from ${SCORE_MIN} to ${SCORE_MAX}`,
  examples: [612],
});

export const yearParam = t.Object({
  year: t.Integer({ minimum: 2013, maximum: 2100, description: "NEET (UG) exam year", examples: [2026] }),
});

export const OutcomeSchema = t.Union([t.Literal("OK"), t.Literal("BELOW_CUTOFF"), t.Literal("NOT_PUBLISHED_BY_NTA")], {
  description:
    "OK: rank fields are filled. BELOW_CUTOFF: the score is under the qualifying cut-off, rank fields are null. " +
    "NOT_PUBLISHED_BY_NTA: NTA published no score counts for that year (only totals and cut-offs), so no rank can be worked out; rank fields are null.",
});

export const RankRangeSchema = t.Object(
  { from: t.Integer({ description: "Best (lowest-numbered) rank this score could have" }), to: t.Integer({ description: "Worst (highest-numbered) rank this score could have" }) },
  { description: "A rank range. Tied students share the range, so it is shown instead of a single rank." },
);
const NullableRange = t.Union([RankRangeSchema, t.Null()]);

// ---- public rank answer ----------------------------------------------------------------

export const SourceRefSchema = t.Object(
  {
    title: t.String(),
    publisher: nullable(t.String()),
    url: nullable(t.String()),
  },
  { description: "The official document the numbers come from" },
);

export const QualificationSchema = t.Object(
  {
    qualified: t.Union([t.Boolean(), t.Null()], { description: "null when this year has no cut-off loaded for the category, so we cannot say" }),
    cutoffScore: t.Union([t.Integer(), t.Null()], { description: "Minimum marks that qualify" }),
    cutoffPercentile: t.Union([t.Number(), t.Null()]),
    appliedGroup: t.Union([GroupSchema, t.Null()], { description: "Which cut-off decided it (the category, or PWD when that is lower)" }),
  },
  { description: "Whether the score reaches the qualifying cut-off" },
);

export const RankResultSchema = t.Object(
  {
    year: t.Integer({ description: "NEET (UG) exam year the answer is based on" }),
    outcome: OutcomeSchema,
    score: t.Integer(),
    category: CategorySchema,
    pwd: t.Boolean(),
    qualification: QualificationSchema,
    allIndiaRank: NullableRange,
    possibleRankSpan: t.Union([RankRangeSchema, t.Null()], {
      description: "Only when `approximate`: the widest range the real rank could fall in (the whole mark range NTA published)",
    }),
    categoryRank: t.Union([RankRangeSchema, t.Null()], { description: "null when the year's data has no category-wise counts. Never guessed." }),
    pwdRank: t.Union([RankRangeSchema, t.Null()], { description: "null unless `pwd` was true and the year has a PwD list" }),
    percentile: t.Union([t.Number(), t.Null()], { description: "Percent of students who scored the same or lower (NTA's definition)" }),
    studentsAhead: t.Union([t.Integer(), t.Null()]),
    studentsAppeared: t.Integer(),
    studentsWithSameScore: t.Union([t.Integer(), t.Null()], { description: "null when `approximate`" }),
    approximate: t.Boolean({ description: "true when the rank is estimated from a published mark range. Tell the student." }),
    basis: t.Union([BasisSchema, t.Null()], { description: "null when NTA published no score counts for the year (outcome NOT_PUBLISHED_BY_NTA)" }),
    explanation: t.Array(t.String(), { description: "Plain-words bullets explaining the answer, ready to show" }),
    source: SourceRefSchema,
    checkedAt: iso,
    tableVersion: t.Union([t.String({ examples: ["2026-3f9a1c0b7d2e"] }), t.Null()], {
      description: "Identifies the exact rank table used. Same score + same version = same answer. null when there is no rank table (NOT_PUBLISHED_BY_NTA).",
    }),
  },
  { description: "The rank answer for one exam year" },
);

export const OtherYearSchema = t.Object(
  {
    year: t.Integer(),
    outcome: OutcomeSchema,
    allIndiaRank: NullableRange,
    approximate: t.Boolean(),
    basis: t.Union([BasisSchema, t.Null()], { description: "null when NTA published no score counts for that year" }),
  },
  { description: "The same score looked up in another published year" },
);

export const MetaSchema = t.Object(
  {
    disclaimer: t.Object({ key: t.String(), version: t.Integer(), text: t.String({ description: "Show next to the result, exactly as written" }) }),
  },
  { description: "Wording that must be shown with the answer" },
);

export const RankResponseSchema = t.Object({ result: RankResultSchema, otherYears: t.Array(OtherYearSchema), meta: MetaSchema });

// ---- public "Data we use" --------------------------------------------------------------

export const CutoffSchema = t.Object({ group: GroupSchema, percentile: t.Number(), minScore: t.Integer() });

export const DataSourceYearSchema = t.Object(
  {
    year: t.Integer(),
    appeared: t.Integer(),
    qualified: t.Union([t.Integer(), t.Null()]),
    topperScore: t.Union([t.Integer(), t.Null()]),
    resultDate: nullable(t.String({ format: "date" })),
    rankData: t.Boolean({ description: "false = NTA published no score counts for this year, so ranks cannot be shown (totals and cut-offs only)" }),
    basis: t.Union([BasisSchema, t.Null()], { description: "null when `rankData` is false" }),
    approximate: t.Boolean({ description: "true when this year's ranks are estimated from mark ranges" }),
    methodNote: nullable(t.String()),
    groups: t.Array(GroupSchema, { description: "Which lists the year has data for. Category and PwD ranks exist only for the groups listed." }),
    cutoffs: t.Array(CutoffSchema),
    source: SourceRefSchema,
    checkedAt: iso,
    tableVersion: nullable(t.String()),
  },
  { description: "One row of the \"Data we use\" table" },
);

export const DataSourcesResponseSchema = t.Object({ years: t.Array(DataSourceYearSchema, { description: "Newest first" }), meta: MetaSchema });

// ---- admin -----------------------------------------------------------------------------

const SourceBriefSchema = t.Object({ id: t.String({ format: "uuid" }), kind: t.String(), title: t.String(), publisher: nullable(t.String()), url: nullable(t.String()) });

export const GroupSummarySchema = t.Object({
  group: GroupSchema,
  rows: t.Integer({ description: "Rows uploaded for this group" }),
  bands: t.Integer({ description: "Rows that cover more than one score" }),
  candidates: t.Integer({ description: "Total candidates in the group" }),
  lowestScore: t.Union([t.Integer(), t.Null()], { description: "Lowest score with at least one candidate" }),
  highestScore: t.Union([t.Integer(), t.Null()], { description: "Highest score with at least one candidate" }),
});

export const YearSchema = t.Object(
  {
    id: t.String({ format: "uuid" }),
    year: t.Integer(),
    status: t.Union([t.Literal("DRAFT"), t.Literal("PUBLISHED")]),
    appeared: t.Integer(),
    qualified: t.Union([t.Integer(), t.Null()]),
    topperScore: t.Union([t.Integer(), t.Null()]),
    rankData: t.Boolean({ description: "false = NTA published no score counts for this year; it is published with totals and cut-offs only" }),
    resultDate: nullable(t.String({ format: "date" })),
    basis: t.Union([BasisSchema, t.Null()], { description: "null until a score-count file has been uploaded (and always null when `rankData` is false)" }),
    methodNote: nullable(t.String()),
    source: SourceBriefSchema,
    checkedAt: iso,
    distribution: t.Union([t.Object({ fileName: nullable(t.String()), sha256: t.String(), uploadedAt: iso }), t.Null()], {
      description: "The last uploaded score-count file; null before the first upload",
    }),
    tableVersion: nullable(t.String()),
    cutoffs: t.Array(CutoffSchema),
    publishedAt: nullable(iso),
    createdAt: iso,
    updatedAt: iso,
  },
  { description: "A NEET exam year (admin view)" },
);

export const YearDetailSchema = t.Composite([
  YearSchema,
  t.Object({
    groups: t.Array(GroupSummarySchema, { description: "What the uploaded file contains" }),
    warnings: t.Array(t.String(), { description: "Cross-check hints about the data. They never block publishing; read them." }),
    publishProblems: t.Array(t.String(), { description: "What still blocks publishing. Empty = ready to publish." }),
  }),
]);

export const UploadReportSchema = t.Object(
  {
    dryRun: t.Boolean({ description: "true = nothing was saved" }),
    basis: BasisSchema,
    groups: t.Array(GroupSummarySchema),
    warnings: t.Array(t.String()),
    rankRowsBuilt: t.Integer({ description: "Rows in the derived rank table (one per integer score per group)" }),
    tableVersion: t.String(),
  },
  { description: "What the uploaded file contains and what was built from it" },
);

export const cutoffInput = t.Object({
  group: CutoffGroupSchema,
  percentile: t.Number({ minimum: 0, maximum: 100, examples: [50] }),
  minScore: t.Integer({ minimum: SCORE_MIN, maximum: SCORE_MAX, examples: [144] }),
});
