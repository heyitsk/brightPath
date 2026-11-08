// Loads the official NEET (UG) 2024-2026 figures as DRAFT years, through the same service functions
// the admin API uses (so validation, rank-table building and the audit log all apply).
//
//   bun run scripts/load-neet-data.ts <folder>
//
// <folder> must contain:
//   phase3-2024-score-counts.csv          exact per-score counts (group ALL)
//   phase3-2026-score-counts-BANDS.csv    counts per mark range built from NTA's published figures
// 2025 needs no file: NTA published no score counts, so it is loaded with totals and cut-offs only.
//
// Safe to re-run: a DRAFT year is refreshed, a PUBLISHED year is left alone. Nothing is published
// here; publish from the admin API after checking the preview. Acts as the first active ADMIN.
import { prisma } from "../src/lib/prisma";
import { createYear, setCutoffs, updateYear, uploadDistribution } from "../src/modules/neet/neet.service";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: bun run scripts/load-neet-data.ts <folder with the CSV files>");

const admin = await prisma.staffUser.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
if (!admin) throw new Error("No active ADMIN user found. Run `bun run admin:bootstrap` first.");
const actor = { id: admin.id, email: admin.email };

const CHECKED_AT = "2026-11-08"; // the day the figures were read from the NTA PDFs

// ---- sources (all NTA documents; one row each, reused on re-runs) ----
async function source(title: string, url: string, notes: string) {
  const existing = await prisma.source.findFirst({ where: { title, kind: "NTA" } });
  if (existing) return existing;
  return prisma.source.create({ data: { kind: "NTA", title, publisher: "National Testing Agency", url, notes, createdById: admin!.id } });
}
const KEY_DATA = await source(
  "Key data points of NEET (UG) over years (2019 to 2026)",
  "https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/07/202607161539405935.pdf",
  "Registered, appeared and qualified per year, and qualifying marks by category (table 8). Read 8 Nov 2026.",
);
const PRESS_2026 = await source(
  "NTA declares result of NEET (UG) 2026 (press release, 16 July 2026)",
  "https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/07/20260716477215762.pdf",
  "Source of the 2026 score counts: 700+, 690+, 650+, 600+, 500+ and the highest score. Read 8 Nov 2026.",
);

// ---- cut-offs (key data points, table 8). PWD = UR/EWS with PwBD (45th percentile); OBC/SC/ST PwBD sit at their category cut-off ----
const cutoffs = (ur: number, obcScSt: number, pwd: number) => [
  { group: "GENERAL", percentile: 50, minScore: ur },
  { group: "EWS", percentile: 50, minScore: ur },
  { group: "OBC", percentile: 40, minScore: obcScSt },
  { group: "SC", percentile: 40, minScore: obcScSt },
  { group: "ST", percentile: 40, minScore: obcScSt },
  { group: "PWD", percentile: 45, minScore: pwd },
] as const;

interface YearPlan {
  year: number;
  appeared: number;
  qualified: number;
  topperScore: number;
  rankData: boolean;
  resultDate: string;
  sourceId: string;
  methodNote: string;
  cutoffs: ReturnType<typeof cutoffs>;
  csvFile?: string;
  csvName?: string;
}

const plans: YearPlan[] = [
  {
    year: 2024,
    appeared: 2333162,
    qualified: 1315853,
    topperScore: 720,
    rankData: true,
    resultDate: "2024-06-04",
    sourceId: KEY_DATA.id,
    methodNote:
      "Exact number of students at every score, taken from the marks NTA published for each exam centre and compiled by a third party. " +
      "These marks may be from before NTA's revised result of 26 July 2024, so a rank can differ slightly from what the revised result would give. " +
      "The qualifying cut-offs and totals are NTA's revised figures. NTA's headline number of students who appeared is 23,33,297; " +
      "its revised tables add up to 23,33,162, which is the figure used here.",
    cutoffs: cutoffs(162, 127, 144),
    csvFile: "phase3-2024-score-counts.csv",
    csvName: "phase3-2024-score-counts.csv",
  },
  {
    year: 2025,
    appeared: 2209318,
    qualified: 1236531,
    topperScore: 686,
    rankData: false,
    resultDate: "2025-06-14",
    sourceId: KEY_DATA.id,
    methodNote: "NTA did not publish how many students got each score in 2025. It published only totals and the qualifying cut-offs, so we cannot work out a rank from a score for this year.",
    cutoffs: cutoffs(144, 113, 127),
  },
  {
    year: 2026,
    appeared: 1999895,
    qualified: 1121185,
    topperScore: 715,
    rankData: true,
    resultDate: "2026-07-16",
    sourceId: PRESS_2026.id,
    methodNote:
      "NTA published only a few counts for 2026: how many students scored 700 or more, 650 or more, 600 or more and 500 or more, plus the number who qualified. " +
      "Ranks between those points are estimates: we spread the students in each score range evenly, so your real rank can be anywhere in the range shown. " +
      "For scores below 213 NTA published no counts; those students are everyone else who appeared.",
    cutoffs: cutoffs(213, 177, 194),
    csvFile: "phase3-2026-score-counts-BANDS.csv",
    csvName: "phase3-2026-score-counts-BANDS.csv",
  },
];

for (const p of plans) {
  const existing = await prisma.neetExamYear.findUnique({ where: { year: p.year } });
  if (existing?.status === "PUBLISHED") {
    console.log(`${p.year}: already published, left alone`);
    continue;
  }
  if (!existing) {
    await createYear(actor, { year: p.year, appeared: p.appeared, qualified: p.qualified, topperScore: p.topperScore, rankData: p.rankData, resultDate: p.resultDate, methodNote: p.methodNote, sourceId: p.sourceId, checkedAt: CHECKED_AT });
    console.log(`${p.year}: created draft`);
  } else {
    await updateYear(actor, p.year, { appeared: p.appeared, qualified: p.qualified, topperScore: p.topperScore, resultDate: p.resultDate, methodNote: p.methodNote, sourceId: p.sourceId, checkedAt: CHECKED_AT });
    console.log(`${p.year}: draft refreshed`);
  }
  await setCutoffs(actor, p.year, [...p.cutoffs]);
  if (p.csvFile) {
    const csv = await Bun.file(`${dir}/${p.csvFile}`).text();
    const report = await uploadDistribution(actor, p.year, { csv, fileName: p.csvName });
    console.log(`${p.year}: ${report.basis}, ${report.rankRowsBuilt} rank rows, table ${report.tableVersion}, warnings: ${report.warnings.length ? report.warnings.join(" | ") : "none"}`);
  }
}
console.log("Done. All years are drafts: check them with GET /admin/neet/years/{year}/preview, then publish.");
await prisma.$disconnect();
process.exit(0);
