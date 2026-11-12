// DEVELOPMENT ONLY. Creates a few invented "Sample ..." colleges (India and abroad) with fee rows and exchange rates, so the
// admin screens, the college page layouts and the Finder have something to show until the real India list arrives.
//
//   bun run scripts/load-mock-colleges.ts            create (safe to re-run)
//   bun run scripts/load-mock-colleges.ts --remove   delete everything this script created
//
// Everything is tied to one import batch of kind MOCK_SAMPLE, every name starts with "Sample", every row has the
// internal note "MOCK SAMPLE DATA", and all colleges stay DRAFT. Refuses to run when NODE_ENV=production.
import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { slugify } from "../src/lib/slug";
import { recalcCourseTotals } from "../src/modules/college/college.service";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to load mock data when NODE_ENV=production.");
const MOCK_FILENAME = "mock-sample-colleges";
const NOTE = "MOCK SAMPLE DATA. Invented for development; delete before launch.";

if (process.argv.includes("--remove")) {
  const batches = await prisma.importBatch.findMany({ where: { kind: "MOCK_SAMPLE" }, select: { id: true } });
  const ids = batches.map((b) => b.id);
  const gone = await prisma.college.deleteMany({ where: { importBatchId: { in: ids } } });
  await prisma.importBatch.deleteMany({ where: { id: { in: ids } } });
  const rates = await prisma.fxRate.deleteMany({ where: { sourceNote: { startsWith: "MOCK" } } });
  const sources = await prisma.source.deleteMany({ where: { notes: { startsWith: "MOCK" } } });
  console.log(`Removed ${gone.count} mock colleges, ${rates.count} mock rates, ${sources.count} mock sources.`);
  await prisma.$disconnect();
  process.exit(0);
}

const existing = await prisma.importBatch.findFirst({ where: { kind: "MOCK_SAMPLE" } });
if (existing) {
  console.log("Mock data already loaded (run with --remove first to reload).");
  await prisma.$disconnect();
  process.exit(0);
}

const state = async (code: string) => (await prisma.state.findUniqueOrThrow({ where: { code } })).id;
const country = async (slug: string) => (await prisma.country.findUniqueOrThrow({ where: { slug } })).id;

const source = await prisma.source.create({
  data: { kind: "OTHER", title: "Sample fee notice (mock)", publisher: "Sample", url: "https://example.com/sample-fee-notice", notes: "MOCK source for development." },
});
const checkedAt = new Date("2026-11-01");

const batch = await prisma.importBatch.create({
  data: { kind: "MOCK_SAMPLE", filename: MOCK_FILENAME, fileSha256: createHash("sha256").update(MOCK_FILENAME).digest("hex"), status: "COMMITTED", committedAt: new Date() },
});

// Mock rates only fill gaps; a real rate someone already entered is never touched.
const rates: Array<[string, number]> = [["USD", 88.5], ["RUB", 0.95], ["UZS", 0.007]];
for (const [currency, rateToInr] of rates) {
  await prisma.fxRate.upsert({ where: { currency }, update: {}, create: { currency, rateToInr, asOf: new Date("2026-11-01"), sourceNote: "MOCK rate for development" } });
}

type Fees = { tuition: number[]; hostel: number; other: number; currency: string };
const feeRows = (f: Fees) => f.tuition.map((tuition, i) => ({ yearNumber: i + 1, tuition, hostel: f.hostel, other: f.other, currency: f.currency, sourceId: source.id, checkedAt }));

const india = [
  { name: "Sample Government Medical College", city: "Lucknow", state: "UP", ownership: "GOVERNMENT" as const, seats: 150, fees: { tuition: [15000, 15000, 15000, 15000, 15000, 0], hostel: 12000, other: 5000, currency: "INR" }, bond: [1, 500000] },
  { name: "Sample Private Medical Institute", city: "Pune", state: "MH", ownership: "PRIVATE" as const, seats: 200, fees: { tuition: [1500000, 1500000, 1500000, 1500000, 1500000, 600000], hostel: 150000, other: 80000, currency: "INR" }, bond: null },
  { name: "Sample Deemed University School of Medicine", city: "Jaipur", state: "RJ", ownership: "DEEMED" as const, seats: 250, fees: { tuition: [1800000, 1800000, 1800000, 1800000, 1800000, 800000], hostel: 180000, other: 100000, currency: "INR" }, bond: null },
  { name: "Sample Trust Medical College", city: "Bengaluru", state: "KA", ownership: "TRUST" as const, seats: 100, fees: { tuition: [900000, 900000, 900000, 900000, 900000, 450000], hostel: 120000, other: 60000, currency: "INR" }, bond: [2, 1000000] },
];
for (const c of india) {
  await prisma.college.create({
    data: {
      slug: slugify(c.name), kind: "INDIA", name: c.name, city: c.city, stateId: await state(c.state), ownership: c.ownership, courseLengthMonths: 66,
      description: "Sample description written for development only.", internalNotes: NOTE, importBatchId: batch.id,
      indiaProfile: { create: { nmcRecognised: true, nmcRecognitionCheckedAt: checkedAt, mbbsSeats: c.seats, hospitalName: `${c.name} Teaching Hospital`, hospitalBeds: 800, serviceBondYears: c.bond?.[0] ?? null, serviceBondPenaltyInr: c.bond?.[1] ?? null } },
      feeLines: { create: feeRows(c.fees) },
      sourceLinks: { create: [{ sourceId: source.id, purpose: "FEE_NOTICE", checkedAt }] },
    },
  });
}

const abroad = [
  { name: "Sample State Medical University", city: "Kazan", country: "russia", fees: { tuition: [5200, 5200, 5200, 5200, 5200, 5200], hostel: 900, other: 600, currency: "USD" } },
  { name: "Sample International Medical Institute", city: "Tashkent", country: "uzbekistan", fees: { tuition: [4100, 4100, 4100, 4100, 4100, 4100], hostel: 700, other: 500, currency: "USD" } },
];
for (const c of abroad) {
  await prisma.college.create({
    data: {
      slug: slugify(c.name), kind: "ABROAD", name: c.name, city: c.city, countryId: await country(c.country), ownership: "GOVERNMENT", courseLengthMonths: 72,
      description: "Sample description written for development only.", internalNotes: NOTE, importBatchId: batch.id,
      abroadProfile: { create: { wdomsListed: "LISTED", wdomsCheckedAt: checkedAt, internshipMonths: 12, teachingLanguage: "English", intakeMonths: [9], nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: checkedAt } },
      feeLines: { create: feeRows(c.fees) },
      sourceLinks: { create: [{ sourceId: source.id, purpose: "FEE_NOTICE", checkedAt }] },
    },
  });
}
await recalcCourseTotals(prisma); // fill each college's rupee total from its fee rows and the mock rates
console.log(`Loaded ${india.length} sample India and ${abroad.length} sample abroad colleges (all DRAFT), ${rates.length} mock exchange rates.`);
await prisma.$disconnect();
