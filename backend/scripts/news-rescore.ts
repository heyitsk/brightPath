// Re-apply the relevance rules to notices nobody has handled yet. Staff decisions are never touched.
//   bun run news:rescore --dry     shows how many notices would move
//   bun run news:rescore           does it
// Run it after changing the rules or the setting `news.relevanceThreshold`.
import { prisma } from "../src/lib/prisma";
import { rescoreItems } from "../src/modules/news/news.service";

const dryRun = process.argv.includes("--dry");
const result = await rescoreItems(null, { dryRun });
console.log(dryRun ? "DRY RUN (nothing saved)" : "Done", result);
await prisma.$disconnect();
process.exit(0);
