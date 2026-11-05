import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { env } from "./config/env";
import { requestLogger } from "./plugins/request-logger";
import { healthRoutes } from "./routes/health";
import { jobRoutes } from "./routes/jobs";

// The app is built here and started in index.ts, so scripts (e.g. OpenAPI export)
// can import it without opening a port.
export const app = new Elysia()
  .use(requestLogger)
  .use(cors({ origin: env.CORS_ORIGIN }))
  .use(
    openapi({
      path: "/openapi", // interactive docs UI; raw spec at /openapi/json
      documentation: {
        info: {
          title: "BrightPath API",
          version: "0.1.0",
          description:
            "Backend API for BrightPath. This spec is the contract for the frontend: " +
            "every route documents its summary, request body and responses. " +
            "Exported to docs/openapi.json via `bun run openapi:export`.",
        },
        tags: [
          { name: "Health", description: "Service and dependency health" },
          { name: "Jobs", description: "Background job enqueueing (BullMQ)" },
        ],
      },
    }),
  )
  .use(healthRoutes)
  .use(jobRoutes);

export type App = typeof app;
