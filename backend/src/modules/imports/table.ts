// Reads an uploaded .xlsx or .csv file into rows of text, finds the header row by column NAME (any order, any case), and turns
// each data row into { field: text }. Shared by every upload kind (colleges, fees). Nothing here touches the database.
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { AppError } from "../../lib/errors";

export const MAX_ROWS = 5000;

export interface RawRow {
  /** 1-based line number as the person sees it in Excel / a text editor. */
  line: number;
  cells: string[];
}
export interface RawTable {
  sheet: string;
  rows: RawRow[];
}

const bad = (message: string): never => {
  throw AppError.invalid(message, [{ path: "file", message }]);
};

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text ?? "").trim(); // hyperlink
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula
    if ("error" in v) return "";
  }
  return String(v).trim().replace(/\s+/g, " ");
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = (b: Uint8Array) => b.length > 3 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/** `sheetNames` are tried in order; if none match but the workbook has a single sheet, that one is used. */
export async function readTable(bytes: Uint8Array, filename: string, sheetNames: readonly string[]): Promise<RawTable> {
  const lower = filename.toLowerCase();
  if (isOle(bytes)) bad("This is an old Excel (.xls) file. Open it in Excel and save it as .xlsx or .csv, then upload again.");
  if (isZip(bytes)) return readWorkbook(bytes, sheetNames);
  if (/\.xls[xm]?$/.test(lower)) bad("This file is not a valid Excel (.xlsx) file. Open it in Excel and save it again, or upload a .csv.");
  if (!/\.(csv|txt)$/.test(lower)) bad("Upload an Excel (.xlsx) or CSV (.csv) file.");
  return readCsv(bytes);
}

async function readWorkbook(bytes: Uint8Array, sheetNames: readonly string[]): Promise<RawTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    bad("This file could not be read as an Excel (.xlsx) file. Open it in Excel and save it again, or upload a .csv.");
  }
  const sheet = sheetNames.map((n) => wb.getWorksheet(n)).find(Boolean) ?? (wb.worksheets.length === 1 ? wb.worksheets[0] : undefined);
  if (!sheet) {
    bad(`Could not find a sheet named ${sheetNames.map((n) => `"${n}"`).join(" or ")}. This workbook has: ${wb.worksheets.map((w) => `"${w.name}"`).join(", ") || "no sheets"}. Rename the right sheet or keep only that one.`);
    throw new Error("unreachable");
  }
  const rows: RawRow[] = [];
  const width = sheet.columnCount;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    if (cells.some(Boolean)) rows.push({ line: r, cells });
  }
  return { sheet: sheet.name, rows };
}

function readCsv(bytes: Uint8Array): RawTable {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, info: true, trim: true }) as unknown as typeof records;
  } catch (e) {
    return bad(`This CSV file could not be read: ${(e as Error).message}`);
  }
  return {
    sheet: "CSV",
    rows: records.map((r) => ({ line: r.info.lines, cells: r.record.map((c) => String(c).replace(/\s+/g, " ").trim()) })).filter((r) => r.cells.some(Boolean)),
  };
}

// ---- columns -------------------------------------------------------------------------------

export type Spec<F extends string> = Record<F, readonly string[]>;
export interface Records<F extends string> {
  sheet: string;
  rows: Array<{ line: number; v: Partial<Record<F, string>> }>;
  /** Header cells that matched no known column (usually a typo, so the preview shows them). */
  ignoredColumns: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[*:]/g, "").replace(/[_\s]+/g, " ").trim();

/** The header is the first of the first 10 rows for which `isHeader` accepts the set of recognised columns. */
export function extractRecords<F extends string>(table: RawTable, spec: Spec<F>, isHeader: (found: ReadonlySet<F>) => boolean, needs: string): Records<F> {
  const lookup = new Map<string, F>();
  for (const [field, aliases] of Object.entries(spec) as Array<[F, readonly string[]]>) for (const a of aliases) lookup.set(norm(a), field);

  let headerAt = -1;
  let colField: Array<F | null> = [];
  for (let i = 0; i < Math.min(10, table.rows.length) && headerAt < 0; i++) {
    const mapped = table.rows[i]!.cells.map((c) => lookup.get(norm(c)) ?? null);
    const found = new Set<F>();
    const seen = new Set<F>();
    // If a column name appears twice, the first one wins.
    const dedup = mapped.map((f) => (f && !seen.has(f) ? (seen.add(f), f) : null));
    dedup.forEach((f) => f && found.add(f));
    if (isHeader(found)) {
      headerAt = i;
      colField = dedup;
    }
  }
  if (headerAt < 0) return bad(`Sheet "${table.sheet}" needs a header row with ${needs}. Download the template to see the expected columns.`) as never;

  const header = table.rows[headerAt]!;
  const ignoredColumns = header.cells.filter((c, i) => c && !colField[i] && norm(c) !== "#" && norm(c) !== "no").map((c) => c);
  const rows: Records<F>["rows"] = [];
  for (const raw of table.rows.slice(headerAt + 1)) {
    const v: Partial<Record<F, string>> = {};
    let any = false;
    raw.cells.forEach((cell, i) => {
      const f = colField[i];
      if (f && cell) {
        v[f] = cell;
        any = true;
      }
    });
    if (any) rows.push({ line: raw.line, v });
  }
  if (rows.length === 0) bad(`Sheet "${table.sheet}" has a header but no data rows.`);
  if (rows.length > MAX_ROWS) bad(`This file has ${rows.length} rows. Upload at most ${MAX_ROWS} rows at a time.`);
  return { sheet: table.sheet, rows, ignoredColumns };
}

// ---- value parsers (return a value, or an error message the preview shows next to the row) ----------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const err = (message: string): Parsed<never> => ({ ok: false, message });

/** "1,500.50", "₹ 1500", "$4500" -> number. Accepts at most 2 decimals. */
export function parseAmount(label: string, s: string, opts: { max?: number } = {}): Parsed<number> {
  const cleaned = s.replace(/[\s,₹$€£]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return err(`${label} "${s}" is not a number. Use digits only, e.g. 4500 or 4500.50.`);
  const n = Number(cleaned);
  if (Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) return err(`${label} "${s}" has more than 2 decimal places.`);
  if (n > (opts.max ?? 99_999_999_999)) return err(`${label} "${s}" is too large.`);
  return ok(n);
}

export function parseWholeNumber(label: string, s: string, min: number, max: number): Parsed<number> {
  const cleaned = s.replace(/[\s,]/g, "");
  if (!/^\d+(\.0+)?$/.test(cleaned)) return err(`${label} "${s}" must be a whole number.`);
  const n = Math.round(Number(cleaned));
  if (n < min || n > max) return err(`${label} "${s}" must be between ${min} and ${max}.`);
  return ok(n);
}

/** ISO (2026-11-01) or day/month/year (01/11/2026, 1-11-2026, the Indian order). Not in the future (one day of slack). */
export function parseCheckedDate(label: string, s: string): Parsed<Date> {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  else return err(`${label} "${s}" is not a date. Use 2026-11-01 or 01/11/2026 (day/month/year).`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return err(`${label} "${s}" is not a real date.`);
  if (date.getTime() > Date.now() + 86_400_000) return err(`${label} "${s}" is in the future.`);
  return ok(date);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Sep; Feb", "September, February", "9/2" -> [2, 9]. */
export function parseMonths(label: string, s: string): Parsed<number[]> {
  const parts = s.split(/[;,/&|]+|\band\b/i).map((p) => p.trim()).filter(Boolean);
  const out = new Set<number>();
  for (const p of parts) {
    const byName = MONTHS.indexOf(p.toLowerCase().slice(0, 3));
    const n = /^\d{1,2}$/.test(p) ? Number(p) : byName >= 0 && /^[a-z]+$/i.test(p) ? byName + 1 : 0;
    if (n < 1 || n > 12) return err(`${label} "${p}" is not a month. Use names like Sep or numbers 1 to 12, separated by ; or ,.`);
    out.add(n);
  }
  return ok([...out].sort((a, b) => a - b));
}

export function parseHttpUrl(label: string, s: string): Parsed<string> {
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return ok(u.toString());
  } catch {
    /* fall through */
  }
  return err(`${label} "${s}" is not a full web address starting with http:// or https://.`);
}
