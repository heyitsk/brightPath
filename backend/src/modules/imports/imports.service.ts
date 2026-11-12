import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { applyCollegePlan, COLLEGE_NEEDS, COLLEGE_SHEETS, COLLEGE_SPEC, collegeHeaderOk, planCollegeRows, type CollegeField, type CollegeRow } from "../college/college-import";
import { applyFeePlan, FEE_NEEDS, FEE_SHEETS, FEE_SPEC, feeHeaderOk, planFeeRows, type FeeField, type FeeRow } from "../college/fee-import";
import { ACTION_PRIORITY, toPreview, type Plan, type PlanAction, type PreviewItem } from "./plan";
import { extractRecords, readTable } from "./table";

// Upload -> preview -> save (Phase 4d). A batch is created by the upload (status VALIDATED) and keeps the parsed rows. Saving
// recomputes the plan against the data as it is then, so the preview can never be stale, and runs in one transaction.

export type UploadKind = "COLLEGES" | "FEES";

interface Payload {
  sheet: string;
  ignoredColumns: string[];
  rows: Array<{ line: number; v: Record<string, string> }>;
}

type AnyPlan = Plan<unknown>;

async function planFor(kind: UploadKind, payload: Payload): Promise<AnyPlan> {
  return (kind === "COLLEGES" ? planCollegeRows(payload.rows as CollegeRow[]) : planFeeRows(payload.rows as FeeRow[])) as Promise<AnyPlan>;
}

async function parseUpload(kind: UploadKind, filename: string, bytes: Uint8Array): Promise<Payload> {
  const table = await readTable(bytes, filename, kind === "COLLEGES" ? COLLEGE_SHEETS : FEE_SHEETS);
  const rec = kind === "COLLEGES"
    ? extractRecords<CollegeField>(table, COLLEGE_SPEC, collegeHeaderOk, COLLEGE_NEEDS)
    : extractRecords<FeeField>(table, FEE_SPEC, feeHeaderOk, FEE_NEEDS);
  return { sheet: rec.sheet, ignoredColumns: rec.ignoredColumns, rows: rec.rows as Payload["rows"] };
}

// ---- previews & DTOs ---------------------------------------------------------------------------

export interface PreviewQuery {
  action?: PlanAction;
  limit?: number;
  offset?: number;
}

function buildPreview(plan: AnyPlan, payload: Payload, notices: string[], q: PreviewQuery = {}) {
  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;
  let items = plan.items.map(toPreview);
  if (q.action) items = items.filter((i) => i.action === q.action).sort((a, b) => a.line - b.line);
  else items = items.sort((a, b) => ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action] || a.line - b.line);
  const notes = [...notices];
  if (payload.ignoredColumns.length) notes.push(`These columns were not recognised and were ignored: ${payload.ignoredColumns.map((c) => `"${c}"`).join(", ")}. Check the spelling against the template.`);
  return {
    sheet: payload.sheet,
    totalRows: payload.rows.length,
    counts: plan.counts,
    groups: plan.groups,
    ignoredColumns: payload.ignoredColumns,
    notices: notes,
    canSave: plan.counts.CREATE + plan.counts.UPDATE > 0,
    hasErrors: plan.counts.ERROR > 0,
    itemsTotal: items.length,
    offset,
    items: items.slice(offset, offset + limit) as PreviewItem[],
  };
}

type BatchRow = Prisma.ImportBatchGetPayload<object>;
type Stats = { counts?: Record<PlanAction, number>; result?: Record<string, number> } | null;

function toBatchDto(b: BatchRow) {
  const stats = (b.stats ?? null) as Stats;
  return {
    id: b.id, kind: b.kind, filename: b.filename, status: b.status,
    counts: stats?.counts ?? null, result: stats?.result ?? null,
    createdById: b.createdById, createdAt: b.createdAt.toISOString(), committedAt: b.committedAt ? b.committedAt.toISOString() : null,
  };
}

const errorList = (plan: AnyPlan) => plan.items.filter((i) => i.action === "ERROR").slice(0, 500).map((i) => ({ line: i.line, label: i.label, message: i.message }));

// ---- upload ------------------------------------------------------------------------------------

/** Reads and plans a file without saving anything (used by the command-line loader's --dry-run). */
export async function previewFile(kind: UploadKind, filename: string, bytes: Uint8Array, q: PreviewQuery = {}) {
  const payload = await parseUpload(kind, filename, bytes);
  const plan = await planFor(kind, payload);
  return { plan, preview: buildPreview(plan, payload, [], { limit: 500, ...q }) };
}

export async function createImport(actor: AuditActor, kind: UploadKind, filename: string, bytes: Uint8Array, q: PreviewQuery = {}) {
  const payload = await parseUpload(kind, filename, bytes);
  const plan = await planFor(kind, payload);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const notices: string[] = [];
  const dup = await prisma.importBatch.findFirst({ where: { kind, fileSha256: sha, status: "COMMITTED" }, orderBy: { committedAt: "desc" } });
  if (dup) notices.push(`This exact file was already saved on ${dup.committedAt!.toISOString().slice(0, 10)}. Saving it again will usually change nothing.`);

  const batch = await prisma.importBatch.create({
    data: {
      kind, filename: filename.slice(0, 255), fileSha256: sha, status: "VALIDATED", createdById: actor.id,
      stats: { counts: plan.counts }, errors: errorList(plan), payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(prisma, { actor, action: "import.upload", entityType: "ImportBatch", entityId: batch.id, after: { kind, filename, rows: payload.rows.length, counts: plan.counts } });
  return { batch: toBatchDto(batch), preview: buildPreview(plan, payload, notices, q) };
}

/** The preview of a batch that is not saved yet, recomputed against today's data. A saved batch has no preview, only its result. */
export async function getImport(id: string, q: PreviewQuery = {}) {
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) throw AppError.notFound("Import not found.");
  let preview = null;
  if (batch.status === "VALIDATED" && batch.payload && (batch.kind === "COLLEGES" || batch.kind === "FEES")) {
    const payload = batch.payload as unknown as Payload;
    preview = buildPreview(await planFor(batch.kind, payload), payload, [], q);
  }
  const errors = (batch.errors ?? []) as Array<{ line: number; label: string; message: string | null }>;
  return { batch: toBatchDto(batch), preview, errors: batch.status === "COMMITTED" ? errors : [] };
}

export async function listImports(q: { kind?: "COLLEGES" | "FEES" | "MOCK_SAMPLE"; status?: BatchRow["status"]; limit?: number; cursor?: string }) {
  const limit = q.limit ?? 50;
  const rows = await prisma.importBatch.findMany({
    where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return { items: page.map(toBatchDto), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

// ---- save ----------------------------------------------------------------------------------------

export async function commitImport(actor: AuditActor, id: string, opts: { skipBadRows?: boolean } = {}) {
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) throw AppError.notFound("Import not found.");
  if (batch.status === "COMMITTED") throw AppError.conflict(`This file was already saved on ${batch.committedAt?.toISOString().slice(0, 10)}. Upload it again to preview a new save.`);
  if (batch.status !== "VALIDATED" || !batch.payload || (batch.kind !== "COLLEGES" && batch.kind !== "FEES")) throw AppError.conflict("This import cannot be saved. Upload the file again.");

  const kind = batch.kind;
  const payload = batch.payload as unknown as Payload;
  const plan = await planFor(kind, payload); // against the data as it is now
  if (plan.counts.ERROR > 0 && !opts.skipBadRows) {
    const bad = plan.items.filter((i) => i.action === "ERROR");
    throw AppError.invalid(
      `${bad.length} ${bad.length === 1 ? "row has a problem" : "rows have problems"}, so nothing was saved. Fix the file and upload it again, or save only the valid rows.`,
      bad.slice(0, 20).map((i) => ({ path: `row ${i.line}`, message: `${i.label ? `${i.label}: ` : ""}${i.message ?? "Problem with this row."}` })),
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.importBatch.updateMany({ where: { id, status: "VALIDATED" }, data: { status: "COMMITTED", committedAt: new Date() } });
      if (claimed.count !== 1) throw AppError.conflict("This import was just saved by someone else.");
      const done = kind === "COLLEGES"
        ? await applyCollegePlan(tx, plan as Plan<never>, id)
        : await applyFeePlan(tx, plan as Plan<never>, actor.id);
      await tx.importBatch.update({ where: { id }, data: { stats: { counts: plan.counts, result: done }, errors: errorList(plan) } });
      await audit(tx, { actor, action: "import.commit", entityType: "ImportBatch", entityId: id, after: { kind, filename: batch.filename, counts: plan.counts, result: done, skippedBadRows: opts.skipBadRows ? plan.counts.ERROR : 0 } });
      return done;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { batch: toBatchDto((await prisma.importBatch.findUniqueOrThrow({ where: { id } }))), result };
}

/** Throws an unsaved import away. Saved imports are history and stay. */
export async function discardImport(actor: AuditActor, id: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) throw AppError.notFound("Import not found.");
  if (batch.status === "COMMITTED") throw AppError.conflict("This import has been saved, so it is kept as a record and cannot be discarded.");
  await prisma.$transaction(async (tx) => {
    await tx.importBatch.delete({ where: { id } });
    await audit(tx, { actor, action: "import.discard", entityType: "ImportBatch", entityId: id, before: { kind: batch.kind, filename: batch.filename, status: batch.status } });
  });
}

// ---- templates -------------------------------------------------------------------------------------

export function templateCsv(kind: UploadKind): string {
  const rows = kind === "COLLEGES"
    ? [
        ["Kind", "Country", "State", "College", "City", "Ownership", "Established", "Course length (months)", "Website", "Teaching language", "Intake", "Internship months", "Seats for Indians", "MBBS seats", "Hospital", "Hospital beds", "Verified", "Note"],
        ["Abroad", "Russia", "", "Example State Medical University", "Kazan", "Government", "1804", "72", "https://example.edu", "English", "Sep", "12", "", "", "", "", "Checked online", "Example row: delete me"],
        ["India", "", "Maharashtra", "Example Government Medical College", "Pune", "Government", "1960", "66", "", "", "", "", "", "150", "Example Teaching Hospital", "800", "", "Example row: delete me"],
      ]
    : [
        ["College", "Country", "Year", "Tuition", "Hostel", "Other", "Currency", "Source URL", "Source", "Checked on"],
        ["Example State Medical University", "Russia", "1", "5000", "900", "400", "USD", "https://example.edu/fees", "University fee notice", "2026-11-01"],
        ["Example State Medical University", "Russia", "2", "5000", "900", "400", "USD", "https://example.edu/fees", "University fee notice", "2026-11-01"],
      ];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
