import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // A folder, not a single file: every *.prisma inside is merged (one file per domain).
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
