import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { env } from "./config/env";
import { ErrorEnvelope } from "./lib/errors";
import { emptyQueryAsAbsent } from "./plugins/empty-query";
import { errorHandler, provideRouteTable } from "./plugins/error-handler";
import { rateLimit } from "./plugins/rate-limit";
import { requestId } from "./plugins/request-id";
import { requestLogger } from "./plugins/request-logger";
import { securityHeaders } from "./plugins/security-headers";
import { auditAdminRoutes } from "./modules/audit/audit.admin.routes";
import { collegeAdminRoutes } from "./modules/college/college.admin.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { geographyAdminRoutes } from "./modules/reference/geography.admin.routes";
import { provenanceAdminRoutes } from "./modules/reference/provenance.admin.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { neetAdminRoutes } from "./modules/neet/neet.admin.routes";
import { neetRoutes } from "./modules/neet/neet.routes";
import { siteAdminRoutes } from "./modules/site/site.admin.routes";
import { siteRoutes } from "./modules/site/site.routes";
import { staffAdminRoutes } from "./modules/staff/staff.admin.routes";

export const API_VERSION = "0.6.0";

// The app is built here and started in index.ts, so scripts (e.g. OpenAPI export) and tests
// can import it without opening a port.
//
// Order matters in Elysia: a hook only applies to routes registered AFTER it. So: infra
// plugins first, then /health and the docs (never rate limited), then the default rate
// limit, then every feature module.
export const app = new Elysia()
  .use(requestId)
  .use(securityHeaders)
  .use(requestLogger)
  .use(errorHandler)
  .use(emptyQueryAsAbsent)
  .use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true, // staff session cookie
      allowedHeaders: ["content-type", "x-bp-admin", "x-request-id", "idempotency-key", "x-unlock-token", "if-none-match"],
      exposeHeaders: ["x-request-id", "etag", "retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"],
    }),
  )
  .use(
    openapi({
      path: "/openapi", // interactive docs UI; raw spec at /openapi/json
      documentation: {
        info: {
          title: "BrightPath API",
          version: API_VERSION,
          description:
            "Backend API for BrightPath: NEET rank predictor, college finder and student enquiries.\n\n" +
            "This spec is the contract for the frontend. Every route documents its summary, parameters, " +
            "request body and responses. Exported to `docs/openapi.json` via `bun run openapi:export`.\n\n" +
            "**Errors.** Every non-2xx response uses one body shape, `{ error: { code, message, fields?, requestId } }`. " +
            "`fields` lists per-field problems for form validation (HTTP 422). `requestId` matches the `X-Request-Id` header.\n\n" +
            "**Empty query values.** A query parameter sent with an empty value (`?limit=`) is treated as not provided.\n\n" +
            "**Rate limits.** Public routes are limited per IP. When exceeded the API answers 429 with a `Retry-After` header.\n\n" +
            "**Staff auth.** `/admin/*` routes need a staff session: `POST /admin/auth/login` sets an httpOnly `bp_session` cookie; send requests with credentials. " +
            "Writes must also send `X-BP-Admin: 1`. Roles: ADMIN (everything), EDITOR (content and data), COUNSELLOR (enquiries). 401 = not logged in, 403 = not allowed.\n\n" +
            "**Changelog.** 0.6.0: college catalogue admin (`/admin/colleges`): create colleges as drafts, edit details, inline fee table (one row per course year, `PUT /admin/colleges/{id}/fees/{year}`), source links, FAQs, and the status actions Mark ready / Move to draft / Archive. Mark ready is refused with 422 and a list of every missing detail until the college is complete; a live college cannot be edited into an incomplete state. NMC notices can now be college-level (`scope` COLLEGE + `collegeId`). 0.5.2: validation errors now name the right field for out-of-range numbers (was `(body)`; unnamed cases are `(request)`) and say what is allowed (\"Enter a whole number from -180 to 720.\") instead of \"Expected union value\"; `GET /neet/rank` answers 404 with error code `NOT_PUBLISHED_YET` while no year is published (a year that is not available is still 422 on `year`). 0.5.1: a locked staff account now answers 429 with error code `ACCOUNT_LOCKED` (was `RATE_LIMITED`); a refused setting value now explains what is allowed. 0.5.0: NEET rank predictor (`GET /neet/rank`, `GET /neet/data-sources`) and NEET data admin (years, cut-offs, score-count upload, preview, publish). 0.4.0: reference data admin (states, countries, sources, NMC notices). 0.3.1: blank query parameters are treated as not provided. 0.3.0: staff login/roles, staff management, site settings, versioned disclaimers, audit log, `GET /site/config`. " +
            "0.2.0: foundation (error envelope, request ids, rate limiting, security headers).",
        },
        tags: [
          { name: "Health", description: "Service and dependency health" },
          { name: "Site", description: "Public site-wide configuration" },
          { name: "NEET", description: "NEET (UG) rank predictor and the data it uses" },
          { name: "Admin · Auth", description: "Staff login, logout, current user, change password" },
          { name: "Admin · Staff", description: "Staff accounts and roles (ADMIN only)" },
          { name: "Admin · Site", description: "Site settings and disclaimer texts (ADMIN only)" },
          { name: "Admin · Audit", description: "Audit log of staff changes (ADMIN only)" },
          { name: "Admin · Reference", description: "States, countries, official sources and NMC notices (EDITOR or ADMIN)" },
          { name: "Admin · Colleges", description: "Colleges: drafts, Mark ready, fee table, sources, FAQs (EDITOR or ADMIN)" },
          { name: "Admin · NEET", description: "NEET years, cut-offs, score-count upload, preview and publish (EDITOR or ADMIN)" },
        ],
        components: { schemas: { ErrorEnvelope } },
      },
    }),
  )
  .use(healthRoutes)
  .use(rateLimit({ name: "default", limit: env.RATE_LIMIT_DEFAULT_PER_MIN, windowSec: 60, scope: "global" }))
  // ---- feature modules: one `.use(...)` per phase, below the default rate limit ----
  .use(siteRoutes)
  .use(neetRoutes)
  .use(authRoutes)
  .use(staffAdminRoutes)
  .use(siteAdminRoutes)
  .use(auditAdminRoutes)
  .use(geographyAdminRoutes)
  .use(provenanceAdminRoutes)
  .use(neetAdminRoutes)
  .use(collegeAdminRoutes);

provideRouteTable(() => app.routes as never);

export type App = typeof app;
