// Loads a college list or a fee list (Excel or CSV) from the command line, through the same pipeline as the admin upload.
//
//   bun run scripts/load-colleges.ts "<file>" [--fees] [--dry-run] [--skip-bad-rows]
//
// Without --fees the file is a college list (columns Country/State, College, City, ...); with --fees it is a fee list.
// Prerequisite: `bun run db:seed` (countries and states must exist).
// Prints the preview, then saves. Safe to re-run: existing colleges are never overwritten (empty fields are filled).
// Nothing is made public; every college starts as a draft. Acts as the first active ADMIN so the audit log shows who loaded it.
import { basename } from "node:path";
import { prisma } from "../src/lib/prisma";
import { commitImport, createImport, previewFile, type UploadKind } from "../src/modules/imports/imports.service";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error('Usage: bun run scripts/load-colleges.ts "<file.xlsx|csv>" [--fees] [--dry-run] [--skip-bad-rows]');
const kind: UploadKind = args.includes("--fees") ? "FEES" : "COLLEGES";
const dryRun = args.includes("--dry-run");
const skipBad = args.includes("--skip-bad-rows");

const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
const name = basename(file);

const show = (p: Awaited<ReturnType<typeof previewFile>>["preview"]) => {
  console.log(`Sheet "${p.sheet}": ${p.totalRows} rows read`);
  console.log("Would create:", p.groups);
  console.log("Summary:", p.counts);
  for (const n of p.notices) console.log("Note:", n);
  for (const i of p.items.filter((x) => x.action === "ERROR" || x.action === "SKIP" || x.action === "UPDATE").slice(0, 60)) console.log(`  row ${i.line} [${i.action}] ${i.label}: ${i.message}`);
};

if (dryRun) {
  show((await previewFile(kind, name, bytes)).preview);
  console.log("Dry run: nothing saved.");
} else {
  const admin = await prisma.staffUser.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No active ADMIN user found. Run `bun run admin:bootstrap` first.");
  const actor = { id: admin.id, email: admin.email };
  const { batch, preview } = await createImport(actor, kind, name, bytes, { limit: 500 });
  show(preview);
  if (preview.hasErrors && !skipBad) {
    console.error(`\n${preview.counts.ERROR} row(s) have problems. Fix the file, or re-run with --skip-bad-rows to save the valid rows only. (Preview kept as import ${batch.id}.)`);
    process.exitCode = 1;
  } else if (!preview.canSave) {
    console.log("Nothing to save: the database already has all of this.");
  } else {
    const res = await commitImport(actor, batch.id, { skipBadRows: skipBad });
    console.log("Saved.", res.result, `Import ${batch.id}.`);
  }
}
await prisma.$disconnect();
