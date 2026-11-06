// Idempotent seed entry point: `bun run db:seed`. Safe to run repeatedly.
// Each phase adds its own seed function here (Phase 2: states/countries, ...).
import { logger } from "../src/lib/logger";
import { prisma } from "../src/lib/prisma";
import { seedReferenceData } from "./seed/reference";

const seeds: Array<{ name: string; run: () => Promise<unknown> }> = [
  { name: "reference-data", run: seedReferenceData },
];

for (const seed of seeds) {
  logger.info({ seed: seed.name }, "seeding");
  const result = await seed.run();
  logger.info({ seed: seed.name, result }, "seeded");
}
logger.info({ count: seeds.length }, "seed complete");
await prisma.$disconnect();
