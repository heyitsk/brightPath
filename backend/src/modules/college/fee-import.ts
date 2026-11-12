// Bulk upload of FEES (Phase 4d): one row per college per course year.
//
// planFeeRows  -> what the file would do (preview; writes nothing)
// applyFeePlan -> does it, inside the caller's transaction
//
// Rules (history.md D-108..D-110):
//  - Unlike college details, a fee row in the file DOES replace the stored one (uploading new fees is the point); the preview
//    lists every old -> new value first, and nothing is saved until the person confirms.
//  - A live college can never be pushed into an incomplete state: a row that would leave one without a source or an exchange
//    rate is an error for that row.
//  - Sources are matched by web address or title. A row may carry a new web address, which creates the source on save.
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { slugify } from "../../lib/slug";
import { blankItem, buildPlan, type Plan, type PlanChange, type PlanItem } from "../imports/plan";
import { parseAmount, parseCheckedDate, parseHttpUrl, parseWholeNumber, type Spec } from "../imports/table";
import { assertStillComplete, loadRates, recalcCourseTotals } from "./college.service";
import { feeYearsRequired, lineTotalInr, lineTotalLocal } from "./college-readiness";

export type FeeField = "slug" | "college" | "country" | "state" | "year" | "tuition" | "hostel" | "other" | "currency" | "sourceTitle" | "sourceUrl" | "checked";

export const FEE_SHEETS = ["Fees", "Fee", "Sheet1"] as const;
export const FEE_SPEC: Spec<FeeField> = {
  slug: ["slug", "college slug", "web address"],
  college: ["college", "college name", "name", "university"],
  country: ["country"],
  state: ["state"],
  year: ["year", "course year", "year number", "yr"],
  tuition: ["tuition", "tuition fee", "tuition fees"],
  hostel: ["hostel", "hostel fee", "hostel and food", "hostel & food"],
  other: ["other", "other fees", "other fee", "other charges"],
  currency: ["currency", "curr", "ccy"],
  sourceTitle: ["source", "source title"],
  sourceUrl: ["source url", "source link", "url"],
  checked: ["checked on", "checked at", "checked", "date checked", "as of"],
};
export const feeHeaderOk = (found: ReadonlySet<FeeField>) => found.has("year") && found.has("tuition") && found.has("currency") && (found.has("slug") || found.has("college"));
export const FEE_NEEDS = 'the columns "College" (or "Slug"), "Year", "Tuition" and "Currency"';

export type FeeRow = { line: number; v: Partial<Record<FeeField, string>> };

export interface FeeApply {
  collegeId: string;
  yearNumber: number;
  tuition: number;
  hostel: number;
  other: number;
  currency: string;
  /** An existing source, or null. */
  sourceId: string | null;
  /** A source to create on save (several rows may share one). */
  newSource: { url: string; title: string } | null;
  /** null = use the day the file is saved. */
  checkedAt: Date | null;
}

const inr = (n: number) => n.toLocaleString("en-IN");
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const normUrl = (u: string) => {
  try { return new URL(u).toString(); } catch { return u; }
};
const sameDay = (a: Date | null, b: Date | null) => (a && b ? a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10) : false);

export async function planFeeRows(rows: FeeRow[]): Promise<Plan<FeeApply>> {
  const [colleges, fees, sources, rates] = await Promise.all([
    prisma.college.findMany({ select: { id: true, slug: true, name: true, status: true, courseLengthMonths: true, country: { select: { name: true } }, state: { select: { name: true } } } }),
    prisma.collegeFeeLine.findMany(),
    prisma.source.findMany({ select: { id: true, title: true, url: true } }),
    loadRates(prisma),
  ]);
  const bySlug = new Map(colleges.map((c) => [c.slug, c]));
  const byName = new Map<string, typeof colleges>();
  for (const c of colleges) {
    const k = c.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const feeAt = new Map(fees.map((f) => [`${f.collegeId}|${f.yearNumber}`, f]));
  const sourceByUrl = new Map(sources.filter((s) => s.url).map((s) => [normUrl(s.url!), s]));
  const sourceByTitle = new Map(sources.map((s) => [s.title.trim().toLowerCase(), s]));
  const seen = new Set<string>();

  const items = rows.map(({ line, v }): PlanItem<FeeApply> => {
    const item: PlanItem<FeeApply> = { ...blankItem(line, v.college ?? v.slug ?? ""), apply: null };
    const fail = (message: string): PlanItem<FeeApply> => ({ ...item, action: "ERROR", message });

    // ---- which college ----
    let college: (typeof colleges)[number] | undefined;
    if (v.slug) {
      college = bySlug.get(v.slug.trim().toLowerCase());
      if (!college) return fail(`There is no college with the web address "${v.slug}".`);
    } else if (v.college) {
      let hits = byName.get(v.college.trim().toLowerCase()) ?? [];
      const where = v.country ?? v.state;
      if (hits.length > 1 && where) hits = hits.filter((c) => slugify(c.country?.name ?? c.state?.name ?? "") === slugify(where));
      if (hits.length === 0) return fail(`There is no college named "${v.college}". Add it first (upload it as a college), or check the spelling.`);
      if (hits.length > 1) return fail(`More than one college is named "${v.college}". Add a Country (or State) column, or use the Slug column.`);
      college = hits[0];
    } else return fail("College is empty.");
    const label = college!.name;
    const base = { ...item, label, slug: college!.slug, targetId: college!.id };

    // ---- the numbers ----
    const problems: string[] = [];
    const yearP = v.year ? parseWholeNumber("Year", v.year, 1, 12) : null;
    if (!yearP) problems.push("Year is empty.");
    else if (!yearP.ok) problems.push(yearP.message);
    const tuitionP = v.tuition ? parseAmount("Tuition", v.tuition) : null;
    if (!tuitionP) problems.push("Tuition is empty (use 0 for a free year).");
    else if (!tuitionP.ok) problems.push(tuitionP.message);
    const hostelP = v.hostel ? parseAmount("Hostel", v.hostel) : null;
    if (hostelP && !hostelP.ok) problems.push(hostelP.message);
    const otherP = v.other ? parseAmount("Other", v.other) : null;
    if (otherP && !otherP.ok) problems.push(otherP.message);
    if (!v.currency) problems.push("Currency is empty.");
    else if (!/^[A-Za-z]{3}$/.test(v.currency)) problems.push(`Currency "${v.currency}" must be a 3-letter code such as USD or INR.`);
    const checkedP = v.checked ? parseCheckedDate("Checked on", v.checked) : null;
    if (checkedP && !checkedP.ok) problems.push(checkedP.message);
    const urlP = v.sourceUrl ? parseHttpUrl("Source URL", v.sourceUrl) : null;
    if (urlP && !urlP.ok) problems.push(urlP.message);
    if (problems.length) return { ...base, action: "ERROR", message: problems.join(" ") };

    const year = (yearP as { value: number }).value;
    const required = feeYearsRequired(college!.courseLengthMonths);
    if (required && year > required) return { ...base, action: "ERROR", message: `${label} has a ${required}-year course, so there is no year ${year}. Fix the year, or change the course length first.` };
    const dupKey = `${college!.id}|${year}`;
    if (seen.has(dupKey)) return { ...base, action: "ERROR", message: `${label} year ${year} appears twice in this file. Remove one of the rows.` };
    seen.add(dupKey);

    const tuition = (tuitionP as { value: number }).value;
    const hostel = hostelP && hostelP.ok ? hostelP.value : 0;
    const other = otherP && otherP.ok ? otherP.value : 0;
    const currency = v.currency!.toUpperCase();
    const checkedAt = checkedP && checkedP.ok ? checkedP.value : null;

    // ---- source ----
    let sourceId: string | null = null;
    let newSource: FeeApply["newSource"] = null;
    const url = urlP && urlP.ok ? normUrl(urlP.value) : null;
    const hit = (url && sourceByUrl.get(url)) || (v.sourceTitle ? sourceByTitle.get(v.sourceTitle.trim().toLowerCase()) : undefined);
    if (hit) sourceId = hit.id;
    else if (url) newSource = { url, title: (v.sourceTitle?.trim() || new URL(url).hostname).slice(0, 200) };
    else if (v.sourceTitle) return { ...base, action: "ERROR", message: `Source "${v.sourceTitle}" is not in the sources list. Add it under Sources, or give its Source URL so it can be added when you save.` };

    // ---- display, warnings, live-college protection ----
    const a: FeeApply = { collegeId: college!.id, yearNumber: year, tuition, hostel, other, currency, sourceId, newSource, checkedAt };
    const rate = currency === "INR" ? 1 : rates.get(currency);
    const total = lineTotalLocal(a);
    const rupees = lineTotalInr(a, rates);
    const detail = `Year ${year}: ${currency} ${money(total)}${currency !== "INR" && rupees !== null ? ` (about ₹${inr(rupees)})` : ""}`;
    const warnings: string[] = [];
    if (!sourceId && !newSource) warnings.push("No source given: this year cannot go live until a source is added.");
    if (rate === undefined) warnings.push(`There is no ${currency} exchange rate yet, so the rupee total stays empty until one is added on the Exchange rates page.`);
    if (college!.status === "READY" && (!sourceId && !newSource)) {
      return { ...base, action: "ERROR", message: `${label} is live, so every fee row needs a source. Add a Source URL or title, or move the college back to draft first.` };
    }
    if (college!.status === "READY" && rate === undefined) {
      return { ...base, action: "ERROR", message: `${label} is live, but there is no ${currency} exchange rate. Add the rate on the Exchange rates page first.` };
    }

    const ready = { ...base, detail, label: `${label}, year ${year}`, warnings, apply: a };
    const old = feeAt.get(dupKey);
    if (!old) return { ...ready, action: "CREATE", message: null };

    const changes: PlanChange[] = [];
    const diff = (field: string, cur: string, up: string) => cur !== up && changes.push({ field, current: cur, uploaded: up });
    diff("tuition", String(Number(old.tuition)), String(tuition));
    diff("hostel", String(Number(old.hostel)), String(hostel));
    diff("other", String(Number(old.other)), String(other));
    diff("currency", old.currency, currency);
    if ((sourceId ?? null) !== old.sourceId && (sourceId || newSource)) changes.push({ field: "source", current: old.sourceId ? "an existing source" : null, uploaded: (hit?.title ?? newSource?.title ?? null) });
    if (checkedAt && !sameDay(checkedAt, old.checkedAt)) changes.push({ field: "checked on", current: old.checkedAt?.toISOString().slice(0, 10) ?? null, uploaded: checkedAt.toISOString().slice(0, 10) });
    if (!changes.length) return { ...ready, action: "UNCHANGED", message: null, apply: null };
    return { ...ready, action: "UPDATE", changes, message: `Replaces the stored fees for year ${year}: ${changes.map((c) => c.field).join(", ")} changes.` };
  });

  return buildPlan(items, (i) => i.label.replace(/, year \d+$/, ""));
}

/** Saves the plan inside the caller's transaction, then re-prices the colleges it touched. */
export async function applyFeePlan(tx: Prisma.TransactionClient, plan: Plan<FeeApply>, createdById: string | null): Promise<{ created: number; updated: number; colleges: number; sourcesCreated: number }> {
  const todo = plan.items.filter((i) => i.apply && (i.action === "CREATE" || i.action === "UPDATE"));

  // New sources first (one per distinct web address).
  const sourceIds = new Map<string, string>();
  for (const i of todo) {
    const ns = i.apply!.newSource;
    if (!ns || sourceIds.has(ns.url)) continue;
    const existing = await tx.source.findFirst({ where: { url: ns.url } });
    const s = existing ?? (await tx.source.create({ data: { kind: "OTHER", title: ns.title, url: ns.url, notes: "Added by bulk fee upload.", createdById } }));
    sourceIds.set(ns.url, s.id);
  }
  const sourcesCreated = new Set(todo.filter((i) => i.apply!.newSource).map((i) => i.apply!.newSource!.url)).size;

  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const i of todo) {
    const a = i.apply!;
    const data = {
      tuition: a.tuition, hostel: a.hostel, other: a.other, currency: a.currency,
      sourceId: a.sourceId ?? (a.newSource ? sourceIds.get(a.newSource.url)! : null), checkedAt: a.checkedAt ?? now,
    };
    await tx.collegeFeeLine.upsert({
      where: { collegeId_yearNumber: { collegeId: a.collegeId, yearNumber: a.yearNumber } },
      update: data, create: { collegeId: a.collegeId, yearNumber: a.yearNumber, ...data },
    });
    if (i.action === "CREATE") created++; else updated++;
  }
  const ids = [...new Set(todo.map((i) => i.apply!.collegeId))];
  await recalcCourseTotals(tx, ids);
  for (const id of ids) await assertStillComplete(tx, id); // safety net: planning already refuses rows that would break a live college
  return { created, updated, colleges: ids.length, sourcesCreated };
}
