// Loads the starting college list (Excel) into the database as DRAFT colleges.
//
//   bun run scripts/load-colleges.ts "<path to .xlsx>" [--dry-run] [--skip-bad-rows]
//
// Prerequisite: `bun run db:seed` (the countries must exist).
// Reads the "All colleges" sheet (columns Country, College, City, Verified, Note), prints a preview, then saves.
// Safe to re-run: existing colleges are never overwritten. Nothing is made public; every college starts as a draft.
// Acts as the first active ADMIN, like load-neet-data.ts, so the audit log shows who loaded it.
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { prisma } from "../src/lib/prisma";
import { commitCollegeImport, parseCollegeWorkbook, planCollegeImport } from "../src/modules/college/college-import";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error('Usage: bun run scripts/load-colleges.ts "<file.xlsx>" [--dry-run] [--skip-bad-rows]');
const dryRun = args.includes("--dry-run");
const skipBad = args.includes("--skip-bad-rows");

const bytes = Buffer.from(await Bun.file(file).arrayBuffer());
const parsed = await parseCollegeWorkbook(bytes);
const plan = await planCollegeImport(parsed.rows);
for (const e of parsed.errors) plan.items.push({ line: e.line, action: "ERROR", country: "", name: "", city: "", slug: null, message: e.message, locationBasis: null, note: null, existingId: null, countryId: null });
plan.counts.ERROR += parsed.errors.length;

console.log(`Sheet "${parsed.sheet}": ${parsed.rows.length} rows read`);
console.log("Would create:", plan.perCountry);
console.log("Summary:", plan.counts);
for (const i of plan.items.filter((x) => x.action === "ERROR" || x.action === "SKIP" || x.action === "UPDATE")) {
  console.log(`  row ${i.line} [${i.action}] ${i.name}: ${i.message}`);
}

if (dryRun) {
  console.log("Dry run: nothing saved.");
} else if (plan.counts.ERROR > 0 && !skipBad) {
  console.error(`\n${plan.counts.ERROR} row(s) have problems. Fix the file, or re-run with --skip-bad-rows to save the valid rows only.`);
  process.exitCode = 1;
} else {
  const admin = await prisma.staffUser.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No active ADMIN user found. Run `bun run admin:bootstrap` first.");
  const result = await commitCollegeImport(plan, {
    filename: basename(file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    actor: { id: admin.id, email: admin.email },
  });
  console.log(result.batchId ? `Saved. Created ${result.created}, updated ${result.updated}. Import batch ${result.batchId}.` : "Nothing to save: the database already has all of these.");
}
await prisma.$disconnect();
