// Bulk upload of COLLEGES (Phase 4a, extended in 4d to India colleges and more columns).
//
// planCollegeRows  -> what the file would do (preview; writes nothing)
// applyCollegePlan -> does it, inside the caller's transaction
//
// Rules (history.md D-084, D-085, D-107):
//  - Every uploaded college starts as a DRAFT. Nothing becomes public by uploading.
//  - A college is recognised by its web address (slug). An existing college is never overwritten: empty fields are filled in,
//    and where the file disagrees with what is stored the stored value is kept and the preview says so.
//  - Problems are reported per row with the file's row number; one bad row never blocks the others.
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { slugify, slugifyShort } from "../../lib/slug";
import type { LocationBasis } from "../../generated/prisma/client";
import { blankItem, buildPlan, type Plan, type PlanChange, type PlanItem } from "../imports/plan";
import { parseHttpUrl, parseMonths, parseWholeNumber, type Spec } from "../imports/table";

export type CollegeField =
  | "kind" | "country" | "state" | "name" | "city" | "ownership" | "established" | "courseLength" | "website" | "verified" | "note"
  | "teachingLanguage" | "intake" | "internship" | "seatsForIndians" | "mbbsSeats" | "hospital" | "hospitalBeds";

export const COLLEGE_SHEETS = ["All colleges", "Colleges", "Sheet1"] as const;
export const COLLEGE_SPEC: Spec<CollegeField> = {
  kind: ["kind", "type", "india or abroad"],
  country: ["country"],
  state: ["state", "state/ut"],
  name: ["college", "college name", "name", "university", "institution"],
  city: ["city", "location"],
  ownership: ["ownership", "type of college", "management"],
  established: ["established", "established year", "year established", "founded", "year founded"],
  courseLength: ["course length (months)", "course length months", "course length", "course months", "duration (months)"],
  website: ["website", "website url", "college website", "official website"],
  verified: ["verified", "city check", "location check"],
  note: ["note", "notes", "remarks"],
  teachingLanguage: ["teaching language", "language of teaching", "medium", "medium of instruction"],
  intake: ["intake", "intake months", "intakes"],
  internship: ["internship months", "internship (months)", "internship"],
  seatsForIndians: ["seats for indians", "indian seats", "seats (indians)"],
  mbbsSeats: ["mbbs seats", "seats", "total seats"],
  hospital: ["hospital", "hospital name", "attached hospital"],
  hospitalBeds: ["hospital beds", "beds"],
};
export const collegeHeaderOk = (found: ReadonlySet<CollegeField>) => found.has("name") && (found.has("country") || found.has("state"));
export const COLLEGE_NEEDS = 'at least the columns "College" and "Country" (for India colleges "State")';

export type CollegeRow = { line: number; v: Partial<Record<CollegeField, string>> };

const LOCATION_BASIS: Record<string, LocationBasis> = {
  "well-known location": "WELL_KNOWN",
  "city is in the college name": "IN_COLLEGE_NAME",
  "checked online": "CHECKED_ONLINE",
};
const OWNERSHIP: Record<string, "GOVERNMENT" | "PRIVATE" | "DEEMED" | "TRUST"> = {
  government: "GOVERNMENT", govt: "GOVERNMENT", public: "GOVERNMENT", private: "PRIVATE", deemed: "DEEMED", "deemed university": "DEEMED", trust: "TRUST",
};
const KINDS: Record<string, "INDIA" | "ABROAD"> = { india: "INDIA", indian: "INDIA", abroad: "ABROAD", foreign: "ABROAD", overseas: "ABROAD", international: "ABROAD" };

/** What committing one row changes. For CREATE it is the whole college; for UPDATE only the fields being filled. */
export interface CollegeApply {
  kind: "INDIA" | "ABROAD";
  slug: string;
  name: string;
  city: string;
  stateId: string | null;
  countryId: string | null;
  base: Prisma.CollegeUncheckedUpdateInput;
  india: Prisma.CollegeIndiaProfileUncheckedUpdateInput;
  abroad: Prisma.CollegeAbroadProfileUncheckedUpdateInput;
}

type Existing = Prisma.CollegeGetPayload<{ include: { indiaProfile: true; abroadProfile: true } }>;
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

/** Compares the file's rows with the database and says what saving would do. Writes nothing. */
export async function planCollegeRows(rows: CollegeRow[]): Promise<Plan<CollegeApply>> {
  const [countries, states, existing] = await Promise.all([
    prisma.country.findMany({ select: { id: true, name: true, slug: true, aliases: true } }),
    prisma.state.findMany({ select: { id: true, name: true, slug: true, code: true, aliases: true } }),
    prisma.college.findMany({ include: { indiaProfile: true, abroadProfile: true } }),
  ]);
  const countryByKey = new Map<string, { id: string; name: string }>();
  for (const c of countries) {
    countryByKey.set(slugify(c.name), c);
    countryByKey.set(c.slug, c);
    for (const a of c.aliases) countryByKey.set(slugify(a), c);
  }
  const stateByKey = new Map<string, { id: string; name: string; slug: string }>();
  for (const s of states) {
    stateByKey.set(slugify(s.name), s);
    stateByKey.set(s.slug, s);
    stateByKey.set(s.code.toLowerCase(), s);
    for (const a of s.aliases) stateByKey.set(slugify(a), s);
  }
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const usedNewSlugs = new Set<string>();
  const seenInFile = new Set<string>();

  const items = rows.map(({ line, v }): PlanItem<CollegeApply> => {
    const name = v.name ?? "";
    const item: PlanItem<CollegeApply> = { ...blankItem(line, name), apply: null };
    const fail = (message: string): PlanItem<CollegeApply> => ({ ...item, action: "ERROR", message });
    const problems: string[] = [];
    const warnings: string[] = [];
    const take = <T>(p: { ok: true; value: T } | { ok: false; message: string }): T | undefined => (p.ok ? p.value : (problems.push(p.message), undefined));

    // ---- kind, place ----
    const explicit = v.kind ? KINDS[v.kind.toLowerCase()] : undefined;
    if (v.kind && !explicit) return fail(`"${v.kind}" is not a known Kind. Use India or Abroad (or leave the column empty).`);
    const countryIsIndia = v.country ? slugify(v.country) === "india" : false;
    if (!explicit && v.state && v.country && !countryIsIndia) return fail("This row has both a Country and a State. Fill only one (State for Indian colleges, Country for foreign ones), or set Kind.");
    const kind = explicit ?? (v.state || countryIsIndia ? "INDIA" : v.country ? "ABROAD" : undefined);
    if (!kind) return fail("Country is empty. Give a Country for foreign colleges, or a State for Indian ones.");

    let place: { id: string; name: string; slug: string };
    if (kind === "INDIA") {
      if (v.country && !countryIsIndia) return fail(`An Indian college cannot have the country "${v.country}". Leave Country empty or use India.`);
      if (!v.state) return fail("State is empty. Indian colleges need a State.");
      const s = stateByKey.get(slugify(v.state));
      if (!s) return fail(`State "${v.state}" is not in the states list.`);
      place = s;
    } else {
      if (v.state) return fail("A foreign college has a country, not a state. Remove the State or set Kind to India.");
      if (!v.country) return fail("Country is empty.");
      const c = countryByKey.get(slugify(v.country));
      if (!c) return fail(`Country "${v.country}" is not in the countries list. Add it under Countries first.`);
      place = { ...c, slug: slugify(c.name) };
    }
    if (!name) return fail("College name is empty.");
    if (!v.city) return fail("City is empty.");
    if (name.length > 200) return fail("College name is longer than 200 characters.");
    if (v.city.length > 100) return fail("City is longer than 100 characters.");

    // ---- optional values (all checked before anything is decided) ----
    const ownership = v.ownership ? OWNERSHIP[v.ownership.toLowerCase()] : undefined;
    if (v.ownership && !ownership) problems.push(`Ownership "${v.ownership}" is not known. Use Government, Private, Deemed or Trust.`);
    const established = v.established ? take(parseWholeNumber("Established year", v.established, 1500, new Date().getFullYear())) : undefined;
    const courseLength = v.courseLength ? take(parseWholeNumber("Course length (months)", v.courseLength, 12, 144)) : undefined;
    const website = v.website ? take(parseHttpUrl("Website", v.website)) : undefined;
    let basis: LocationBasis | undefined;
    if (v.verified) {
      basis = LOCATION_BASIS[v.verified.toLowerCase()];
      if (!basis) problems.push(`"${v.verified}" is not a known value for Verified. Use "Well-known location", "City is in the college name" or "Checked online".`);
    }
    if (v.hospital && v.hospital.length > 200) problems.push("Hospital name is longer than 200 characters.");
    if (v.teachingLanguage && v.teachingLanguage.length > 80) problems.push("Teaching language is longer than 80 characters.");

    const india: Record<string, unknown> = {};
    const abroad: Record<string, unknown> = {};
    if (kind === "INDIA") {
      if (v.mbbsSeats) { const n = take(parseWholeNumber("MBBS seats", v.mbbsSeats, 1, 2000)); if (n !== undefined) india.mbbsSeats = n; }
      if (v.hospital) india.hospitalName = v.hospital;
      if (v.hospitalBeds) { const n = take(parseWholeNumber("Hospital beds", v.hospitalBeds, 0, 20000)); if (n !== undefined) india.hospitalBeds = n; }
      for (const f of ["teachingLanguage", "intake", "internship", "seatsForIndians"] as const) if (v[f]) warnings.push(`The ${f === "seatsForIndians" ? "Seats for Indians" : f === "teachingLanguage" ? "Teaching language" : f === "intake" ? "Intake" : "Internship"} column only applies to foreign colleges, so it was ignored.`);
    } else {
      if (v.teachingLanguage) abroad.teachingLanguage = v.teachingLanguage;
      if (v.intake) { const m = take(parseMonths("Intake", v.intake)); if (m) abroad.intakeMonths = m; }
      if (v.internship) { const n = take(parseWholeNumber("Internship months", v.internship, 0, 60)); if (n !== undefined) abroad.internshipMonths = n; }
      if (v.seatsForIndians) { const n = take(parseWholeNumber("Seats for Indians", v.seatsForIndians, 0, 5000)); if (n !== undefined) abroad.seatsForIndians = n; }
      for (const f of ["mbbsSeats", "hospital", "hospitalBeds"] as const) if (v[f]) warnings.push(`The ${f === "mbbsSeats" ? "MBBS seats" : f === "hospital" ? "Hospital" : "Hospital beds"} column only applies to Indian colleges, so it was ignored.`);
    }
    if (problems.length) return fail(problems.join(" "));

    const base: Record<string, unknown> = {};
    if (ownership) base.ownership = ownership;
    if (established !== undefined) base.establishedYear = established;
    if (courseLength !== undefined) base.courseLengthMonths = courseLength;
    if (website) base.websiteUrl = website;
    if (basis) base.locationBasis = basis;
    if (v.note) base.internalNotes = v.note;

    const dupKey = `${kind}|${place.id}|${name.toLowerCase()}`;
    if (seenInFile.has(dupKey)) return fail(`"${name}" appears twice for ${place.name}. Remove one of the rows.`);
    seenInFile.add(dupKey);

    // ---- slug: plain name first; on a clash with a different college add the place, then a number ----
    const root = slugifyShort(name);
    if (!root) return fail("College name has no letters or digits to build a web address from.");
    const candidates = [root, `${root}-${place.slug}`, ...Array.from({ length: 8 }, (_, i) => `${root}-${place.slug}-${i + 2}`)];
    let slug: string | null = null;
    let match: Existing | undefined;
    for (const cand of candidates) {
      const owner = bySlug.get(cand);
      if (owner) {
        const samePlace = kind === "INDIA" ? owner.stateId === place.id : owner.countryId === place.id;
        if (owner.kind === kind && samePlace && owner.name.toLowerCase() === name.toLowerCase()) {
          slug = cand;
          match = owner;
          break;
        }
        continue; // taken by a different college
      }
      if (!usedNewSlugs.has(cand)) { slug = cand; break; }
    }
    if (!slug) return fail("Could not build a unique web address for this college.");

    const labelled = { ...item, label: `${name} (${place.name})`, detail: [v.city, ownership ? ownership.charAt(0) + ownership.slice(1).toLowerCase() : null].filter(Boolean).join(", "), slug, warnings };
    const apply = (b: object, i: object, a: object): CollegeApply => ({ kind, slug: slug!, name, city: v.city!, stateId: kind === "INDIA" ? place.id : null, countryId: kind === "ABROAD" ? place.id : null, base: b, india: i, abroad: a });

    if (!match) {
      usedNewSlugs.add(slug);
      return { ...labelled, action: "CREATE", message: null, apply: apply(base, india, abroad) };
    }

    // ---- existing college: fill what is empty, keep what staff have, say where the file disagrees ----
    const changes: PlanChange[] = [];
    const fillBase: Record<string, unknown> = {};
    const fillIndia: Record<string, unknown> = {};
    const fillAbroad: Record<string, unknown> = {};
    const consider = (field: string, current: unknown, uploaded: unknown, into: Record<string, unknown>, key: string) => {
      if (uploaded === undefined) return;
      const empty = current === null || current === undefined || current === "" || (Array.isArray(current) && current.length === 0);
      if (empty) { into[key] = uploaded; changes.push({ field, current: null, uploaded: show(uploaded) }); }
      else if (show(current) !== show(uploaded)) warnings.push(`Kept the stored ${field} "${show(current)}" (the file says "${show(uploaded)}").`);
    };
    if (v.city && v.city !== match.city) warnings.push(`Kept the stored city "${match.city}" (the file says "${v.city}").`);
    consider("ownership", match.ownership, base.ownership, fillBase, "ownership");
    consider("established year", match.establishedYear, base.establishedYear, fillBase, "establishedYear");
    consider("course length (months)", match.courseLengthMonths, base.courseLengthMonths, fillBase, "courseLengthMonths");
    consider("website", match.websiteUrl, base.websiteUrl, fillBase, "websiteUrl");
    consider("city check", match.locationBasis, base.locationBasis, fillBase, "locationBasis");
    consider("note", match.internalNotes, base.internalNotes, fillBase, "internalNotes");
    if (kind === "INDIA") {
      consider("MBBS seats", match.indiaProfile?.mbbsSeats, india.mbbsSeats, fillIndia, "mbbsSeats");
      consider("hospital", match.indiaProfile?.hospitalName, india.hospitalName, fillIndia, "hospitalName");
      consider("hospital beds", match.indiaProfile?.hospitalBeds, india.hospitalBeds, fillIndia, "hospitalBeds");
    } else {
      consider("teaching language", match.abroadProfile?.teachingLanguage, abroad.teachingLanguage, fillAbroad, "teachingLanguage");
      consider("intake months", match.abroadProfile?.intakeMonths, abroad.intakeMonths, fillAbroad, "intakeMonths");
      consider("internship months", match.abroadProfile?.internshipMonths, abroad.internshipMonths, fillAbroad, "internshipMonths");
      consider("seats for Indians", match.abroadProfile?.seatsForIndians, abroad.seatsForIndians, fillAbroad, "seatsForIndians");
    }
    const common = { ...labelled, targetId: match.id, changes };
    if (!changes.length) {
      return match.status === "DRAFT"
        ? { ...common, action: "UNCHANGED", message: null }
        : { ...common, action: "SKIP", message: `Already ${match.status.toLowerCase()}; left as it is.` };
    }
    return {
      ...common, action: "UPDATE", message: `Already exists as a ${match.status.toLowerCase()}; fills the empty ${changes.map((c) => c.field).join(", ")} only.`,
      apply: apply(fillBase, fillIndia, fillAbroad),
    };
  });

  return buildPlan(items, (i) => (i.label.match(/\(([^)]+)\)$/)?.[1] ?? null));
}

/** Writes the plan inside the caller's transaction. Rows with errors, and rows that change nothing, are skipped. */
export async function applyCollegePlan(tx: Prisma.TransactionClient, plan: Plan<CollegeApply>, batchId: string): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const item of plan.items) {
    const a = item.apply;
    if (!a) continue;
    if (item.action === "CREATE") {
      await tx.college.create({
        data: {
          ...(a.base as Prisma.CollegeUncheckedCreateInput),
          slug: a.slug, kind: a.kind, name: a.name, city: a.city, stateId: a.stateId, countryId: a.countryId, status: "DRAFT", importBatchId: batchId,
          ...(a.kind === "INDIA"
            ? { indiaProfile: { create: a.india as Prisma.CollegeIndiaProfileUncheckedCreateWithoutCollegeInput } }
            : { abroadProfile: { create: a.abroad as Prisma.CollegeAbroadProfileUncheckedCreateWithoutCollegeInput } }),
        },
      });
      created++;
    } else if (item.action === "UPDATE" && item.targetId) {
      if (Object.keys(a.base).length) await tx.college.update({ where: { id: item.targetId }, data: a.base });
      if (a.kind === "INDIA" && Object.keys(a.india).length) {
        await tx.collegeIndiaProfile.upsert({ where: { collegeId: item.targetId }, update: a.india, create: { collegeId: item.targetId, ...(a.india as object) } });
      }
      if (a.kind === "ABROAD" && Object.keys(a.abroad).length) {
        await tx.collegeAbroadProfile.upsert({ where: { collegeId: item.targetId }, update: a.abroad, create: { collegeId: item.targetId, ...(a.abroad as object) } });
      }
      updated++;
    }
  }
  return { created, updated };
}
