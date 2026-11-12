// College list import: parse an Excel sheet -> build a preview ("plan") -> commit the plan.
//
// The same three functions serve the one-off loader (`scripts/load-colleges.ts`) and, in step 4d, the admin bulk upload
// (preview first, save after). Nothing here writes to the database except `commitCollegeImport`.
//
// Rules (history.md D-082..D-085):
//  - Every imported college starts as an abroad DRAFT. Nothing becomes public by importing.
//  - Re-running is safe: a college is recognised by its slug; an existing college is never overwritten, only
//    given the starting-list note / location check if it has none (staff edits survive).
//  - Problems are reported per row with the sheet row number; one bad row never blocks the others.
import ExcelJS from "exceljs";
import { audit, type AuditActor } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { slugify, slugifyShort } from "../../lib/slug";
import type { LocationBasis } from "../../generated/prisma/client";

export interface ImportRow {
  /** 1-based row number in the sheet, for error messages. */
  line: number;
  country: string;
  name: string;
  city: string;
  verified: string | null;
  note: string | null;
}

export interface ParseResult {
  rows: ImportRow[];
  /** Problems that stop a row from being read at all (e.g. missing college name). */
  errors: Array<{ line: number; message: string }>;
  sheet: string;
}

export type PlanAction = "CREATE" | "UPDATE" | "UNCHANGED" | "SKIP" | "ERROR";

export interface PlanItem {
  line: number;
  action: PlanAction;
  country: string;
  name: string;
  city: string;
  slug: string | null;
  /** Plain-words explanation, always present for SKIP / ERROR / UPDATE. */
  message: string | null;
  locationBasis: LocationBasis | null;
  note: string | null;
  /** Set for UPDATE / UNCHANGED / SKIP: the college already in the database. */
  existingId: string | null;
  countryId: string | null;
}

export interface ImportPlan {
  items: PlanItem[];
  counts: Record<PlanAction, number>;
  perCountry: Record<string, number>;
}

const SHEET_NAMES = ["All colleges", "Colleges", "Sheet1"];
const HEADER_ALIASES: Record<keyof Omit<ImportRow, "line">, string[]> = {
  country: ["country"],
  name: ["college", "college name", "name", "university"],
  city: ["city", "location"],
  verified: ["verified", "city check", "location check"],
  note: ["note", "notes", "remarks"],
};

const LOCATION_BASIS: Record<string, LocationBasis> = {
  "well-known location": "WELL_KNOWN",
  "city is in the college name": "IN_COLLEGE_NAME",
  "checked online": "CHECKED_ONLINE",
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text ?? "").trim(); // hyperlink
    if ("result" in v) return String(v.result ?? "").trim(); // formula
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim().replace(/\s+/g, " ");
}

/** Reads the college sheet of an .xlsx file. Columns are found by their header names, in any order. */
export async function parseCollegeWorkbook(data: ArrayBuffer | Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const sheet = SHEET_NAMES.map((n) => wb.getWorksheet(n)).find(Boolean);
  if (!sheet) {
    throw new Error(`Could not find a sheet named ${SHEET_NAMES.map((n) => `"${n}"`).join(" or ")}. Found: ${wb.worksheets.map((w) => `"${w.name}"`).join(", ") || "none"}.`);
  }

  // Header = the first row (within the first 10) that contains both a country and a college column.
  let headerRow = 0;
  const colOf: Partial<Record<keyof Omit<ImportRow, "line">, number>> = {};
  for (let r = 1; r <= Math.min(10, sheet.rowCount) && !headerRow; r++) {
    const found: typeof colOf = {};
    sheet.getRow(r).eachCell((cell, col) => {
      const text = cellText(cell.value).toLowerCase();
      for (const [field, names] of Object.entries(HEADER_ALIASES)) {
        if (names.includes(text) && !(field in found)) found[field as keyof typeof found] = col;
      }
    });
    if (found.country && found.name) {
      headerRow = r;
      Object.assign(colOf, found);
    }
  }
  if (!headerRow) throw new Error(`Sheet "${sheet.name}" needs a header row with at least the columns "Country" and "College" (and ideally "City").`);

  const rows: ImportRow[] = [];
  const errors: ParseResult["errors"] = [];
  const get = (r: ExcelJS.Row, f: keyof typeof colOf) => (colOf[f] ? cellText(r.getCell(colOf[f]!).value) : "");
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const country = get(row, "country");
    const name = get(row, "name");
    const city = get(row, "city");
    if (!country && !name && !city) continue; // blank line
    if (!name) {
      errors.push({ line: r, message: "College name is empty." });
      continue;
    }
    rows.push({ line: r, country, name, city, verified: get(row, "verified") || null, note: get(row, "note") || null });
  }
  return { rows, errors, sheet: sheet.name };
}

/** Compares the rows with what is already in the database and says what committing would do. Writes nothing. */
export async function planCollegeImport(rows: ImportRow[]): Promise<ImportPlan> {
  const countries = await prisma.country.findMany({ select: { id: true, name: true, slug: true, aliases: true } });
  const countryByKey = new Map<string, { id: string; name: string }>();
  for (const c of countries) {
    countryByKey.set(slugify(c.name), c);
    countryByKey.set(c.slug, c);
    for (const a of c.aliases) countryByKey.set(slugify(a), c);
  }

  const existing = await prisma.college.findMany({
    select: { id: true, slug: true, name: true, countryId: true, status: true, locationBasis: true, internalNotes: true },
  });
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const usedNewSlugs = new Set<string>();
  const seenInFile = new Set<string>();

  const items: PlanItem[] = rows.map((row): PlanItem => {
    const base: PlanItem = {
      line: row.line, action: "ERROR", country: row.country, name: row.name, city: row.city, slug: null, message: null,
      locationBasis: null, note: row.note, existingId: null, countryId: null,
    };
    const fail = (message: string): PlanItem => ({ ...base, action: "ERROR", message });

    if (!row.country) return fail("Country is empty.");
    const country = countryByKey.get(slugify(row.country));
    if (!country) return fail(`Country "${row.country}" is not in the countries list. Add it under Countries first.`);
    if (!row.city) return fail("City is empty.");
    if (row.name.length > 200) return fail("College name is longer than 200 characters.");
    if (row.city.length > 100) return fail("City is longer than 100 characters.");

    let locationBasis: LocationBasis | null = null;
    if (row.verified) {
      locationBasis = LOCATION_BASIS[row.verified.toLowerCase()] ?? null;
      if (!locationBasis) return fail(`"${row.verified}" is not a known value for Verified. Use "Well-known location", "City is in the college name" or "Checked online".`);
    }

    const dupKey = `${country.id}|${row.name.toLowerCase()}`;
    if (seenInFile.has(dupKey)) return fail(`"${row.name}" appears twice for ${country.name}. Remove one of the rows.`);
    seenInFile.add(dupKey);

    // Slug: plain name first; on a clash with a different college add the country code, then a number.
    const root = slugifyShort(row.name);
    if (!root) return fail("College name has no letters or digits to build a web address from.");
    const iso = slugify(country.name);
    const candidates = [root, `${root}-${iso}`, ...Array.from({ length: 8 }, (_, i) => `${root}-${iso}-${i + 2}`)];
    let slug: string | null = null;
    let match: (typeof existing)[number] | undefined;
    for (const cand of candidates) {
      const owner = bySlug.get(cand);
      if (owner) {
        if (owner.countryId === country.id && owner.name.toLowerCase() === row.name.toLowerCase()) {
          slug = cand;
          match = owner;
          break;
        }
        continue; // taken by a different college
      }
      if (!usedNewSlugs.has(cand)) {
        slug = cand;
        break;
      }
    }
    if (!slug) return fail("Could not build a unique web address for this college.");

    if (!match) {
      usedNewSlugs.add(slug);
      return { ...base, action: "CREATE", slug, locationBasis, countryId: country.id, message: null };
    }

    // Existing college: staff may have edited it, so never overwrite; only fill what is still empty.
    const fills: string[] = [];
    if (locationBasis && !match.locationBasis) fills.push("city check");
    if (row.note && !match.internalNotes) fills.push("note");
    const common = { ...base, slug, locationBasis, existingId: match.id, countryId: country.id };
    if (!fills.length) return { ...common, action: match.status === "DRAFT" ? "UNCHANGED" : "SKIP", message: match.status === "DRAFT" ? null : `Already ${match.status.toLowerCase()}; left as it is.` };
    return { ...common, action: "UPDATE", message: `Already exists as a ${match.status.toLowerCase()}; fills the empty ${fills.join(" and ")} only.` };
  });

  const counts: ImportPlan["counts"] = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, SKIP: 0, ERROR: 0 };
  const perCountry: Record<string, number> = {};
  for (const i of items) {
    counts[i.action]++;
    if (i.action === "CREATE") perCountry[i.country] = (perCountry[i.country] ?? 0) + 1;
  }
  return { items, counts, perCountry };
}

export interface CommitResult {
  /** Null when there was nothing to save (no batch is recorded for a no-op). */
  batchId: string | null;
  created: number;
  updated: number;
}

/**
 * Applies a plan in one transaction (all or nothing). Rows with errors are never written, so the caller decides
 * whether to commit a plan that still has errors (the script refuses; the admin screen can offer "save the valid rows").
 */
export async function commitCollegeImport(plan: ImportPlan, meta: { filename: string; sha256: string; actor: AuditActor | null }): Promise<CommitResult> {
  if (plan.counts.CREATE + plan.counts.UPDATE === 0) return { batchId: null, created: 0, updated: 0 };
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        kind: "COLLEGES", filename: meta.filename, fileSha256: meta.sha256, status: "UPLOADED", createdById: meta.actor?.id ?? null,
        stats: plan.counts, errors: plan.items.filter((i) => i.action === "ERROR").map((i) => ({ line: i.line, name: i.name, message: i.message })),
      },
    });
    let created = 0;
    let updated = 0;
    for (const item of plan.items) {
      if (item.action === "CREATE") {
        await tx.college.create({
          data: {
            slug: item.slug!, kind: "ABROAD", name: item.name, city: item.city, countryId: item.countryId!,
            status: "DRAFT", locationBasis: item.locationBasis, internalNotes: item.note, importBatchId: batch.id,
            abroadProfile: { create: {} },
          },
        });
        created++;
      } else if (item.action === "UPDATE") {
        const current = await tx.college.findUniqueOrThrow({ where: { id: item.existingId! }, select: { locationBasis: true, internalNotes: true } });
        await tx.college.update({
          where: { id: item.existingId! },
          data: {
            ...(item.locationBasis && !current.locationBasis ? { locationBasis: item.locationBasis } : {}),
            ...(item.note && !current.internalNotes ? { internalNotes: item.note } : {}),
          },
        });
        updated++;
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date() } });
    await audit(tx, { actor: meta.actor, action: "college_import.commit", entityType: "ImportBatch", entityId: batch.id, after: { filename: meta.filename, created, updated, counts: plan.counts } });
    return { batchId: batch.id, created, updated };
  });
}
