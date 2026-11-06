// Idempotent seed entry point: `bun run db:seed`. Safe to run repeatedly.
// Each phase adds its own seed function here (Phase 1: none, Phase 2: states/countries, ...).
import { logger } from "../src/lib/logger";
import { prisma } from "../src/lib/prisma";

const seeds: Array<{ name: string; run: () => Promise<void> }> = [
  // { name: "reference-data", run: seedReferenceData },
];

for (const seed of seeds) {
  logger.info({ seed: seed.name }, "seeding");
  await seed.run();
}
logger.info({ count: seeds.length }, "seed complete");
await prisma.$disconnect();
