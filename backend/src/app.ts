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
import { fxAdminRoutes } from "./modules/fx/fx.admin.routes";
import { importsAdminRoutes } from "./modules/imports/imports.admin.routes";
import { newsAdminRoutes, newsSourceReadRoutes } from "./modules/news/news.admin.routes";
import { newsPublicRoutes } from "./modules/news/news.public.routes";
import { newsReviewRoutes } from "./modules/news/news.review.routes";
import { collegePublicRoutes } from "./modules/college/college.public.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { geographyAdminRoutes, statesReadRoutes } from "./modules/reference/geography.admin.routes";
import { provenanceAdminRoutes } from "./modules/reference/provenance.admin.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { neetAdminRoutes } from "./modules/neet/neet.admin.routes";
import { neetRoutes } from "./modules/neet/neet.routes";
import { siteAdminRoutes } from "./modules/site/site.admin.routes";
import { siteRoutes } from "./modules/site/site.routes";
import { staffAdminRoutes } from "./modules/staff/staff.admin.routes";

export const API_VERSION = "0.16.3";

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
            "**Changelog.** 0.16.3: `GET /colleges/{slug}` now returns `india.serviceBond` as `{ years: 0, penaltyInr: null }` when the college has no service bond, and still `null` when the bond is not recorded; `GET /site/config` has a new `company` object with `legalName` and `registrationDetails` for the footer (null until an admin sets the settings `company.legalName` and `company.registrationDetails`). 0.16.2: `GET /admin/states` and `GET /admin/news/sources` are now open to every staff role, so counsellors can filter by state and source; a COUNSELLOR gets a slim source row (`id`, `slug`, `name`, `state`, `kind`, `isActive`, `status`) and in that response the other source fields are absent, so they are now optional in the schema. Everything that writes, and the by-id routes, still need EDITOR or ADMIN. 0.16.1: public news items (`GET /news`, `GET /news/{slug}`) now carry `firstSeenAt`, the date BrightPath first found the notice; use it as the \"added on\" date when the site gave no date (`dateBasis` FIRST_SEEN). `publishedAt` is still when staff published it. 0.16.0: news sources can now be of kind `JSON_LIST` (a JSON address that lists notices, read with `itemsPath`, `titlePath` and an address setting) and HTML pages can use `postbackLinks`; `HTML_JS` now means a page that cannot be read (it needs a browser, or is closed to our bot) and cannot be switched on. West Bengal, Gujarat, UP and Rajasthan are now read; MCC, Assam, MP, Mizoram and Punjab stay off with a stated reason. 0.15.0: news review and the public News page. Staff (any role) review fetched notices with `/admin/news/items`: filter by status, state, source, category and search; edit the wording; write a summary; publish, reject, unpublish, restore, or reject/restore many at once. Published notices appear on the public `GET /news` (filters, facets, pinned first) and `GET /news/{slug}`, each linking to the official notice with its source, date and the date staff checked it. 0.14.0: news relevance: fetched notices are scored by keyword rules and the ones that are not about MBBS or NEET UG counselling (PG, AYUSH, nursing, other courses, recruitment, university exams) go to a Filtered tab instead of the review queue, each with the rules that fired; new `POST /admin/news/relevance/test`, `POST /admin/news/rescore`, `GET /admin/news/stats` (open to all staff); a notice with the same title as an earlier one is flagged as a repeat; a source turning broken or recovering is written to the audit log; new setting `news.relevanceThreshold`. 0.13.0: news sources of kind `HTML_LIST` can now be read: ordinary web pages, using per-site settings in `config` (where the notices are, where titles and dates are). 20 official sites are set up and switched on; `POST /admin/news/sources/{id}/test` shows what a site would yield. A page whose layout has changed is reported as a failed run so the source's health shows it. Pages filled in by JavaScript are `HTML_JS` and still cannot be switched on. 0.12.0: news tool, step 1 (`/admin/news/sources`): the list of official sites watched for admission notices, with health, a test button that shows what would be found without storing anything, fetch-now, and run history. Sources are read from RSS feeds and WordPress APIs for now; HTML pages follow. Notice review and the public news page come in later steps. 0.11.0: college cards (`GET /colleges`, and `nearby` on a college page) now carry `firstYearFeeInr` and `mbbsSeats`; uploads carry `createdByName`; the upload preview has `warningsCount` and a `?warnings=true` filter. 0.10.0: homepage hero text and announcement strip, editable by an admin (`GET`/`PATCH /admin/site/homepage`, also available as ordinary settings) and returned by `GET /site/config` as `hero` and `announcement` (the strip only while it is switched on and inside its optional start/end time). 0.9.0: public college directory and pages (`GET /colleges`, `GET /colleges/{slug}`): ready colleges only (a foreign college once its country is live), with filters, sorting, paging and filter facets; one page shape with an India and an abroad variant. 0.8.0: bulk upload (`/admin/imports`): upload an Excel or CSV file of colleges or of fees, get a row-by-row preview, then save it in one step or discard it. CSV templates at `/admin/imports/templates/{kind}`. 0.7.0: exchange rates (`/admin/fx-rates`): one rate per currency, set singly or in bulk; changing a rate recalculates the rupee total of every college using that currency in the same step; a change of more than 20% needs `confirmLargeChange`; a rate cannot be removed while a live college uses it. 0.6.0: college catalogue admin (`/admin/colleges`): create colleges as drafts, edit details, inline fee table (one row per course year, `PUT /admin/colleges/{id}/fees/{year}`), source links, FAQs, and the status actions Mark ready / Move to draft / Archive. Mark ready is refused with 422 and a list of every missing detail until the college is complete; a live college cannot be edited into an incomplete state. NMC notices can now be college-level (`scope` COLLEGE + `collegeId`). 0.5.2: validation errors now name the right field for out-of-range numbers (was `(body)`; unnamed cases are `(request)`) and say what is allowed (\"Enter a whole number from -180 to 720.\") instead of \"Expected union value\"; `GET /neet/rank` answers 404 with error code `NOT_PUBLISHED_YET` while no year is published (a year that is not available is still 422 on `year`). 0.5.1: a locked staff account now answers 429 with error code `ACCOUNT_LOCKED` (was `RATE_LIMITED`); a refused setting value now explains what is allowed. 0.5.0: NEET rank predictor (`GET /neet/rank`, `GET /neet/data-sources`) and NEET data admin (years, cut-offs, score-count upload, preview, publish). 0.4.0: reference data admin (states, countries, sources, NMC notices). 0.3.1: blank query parameters are treated as not provided. 0.3.0: staff login/roles, staff management, site settings, versioned disclaimers, audit log, `GET /site/config`. " +
            "0.2.0: foundation (error envelope, request ids, rate limiting, security headers).",
        },
        tags: [
          { name: "Health", description: "Service and dependency health" },
          { name: "Site", description: "Public site-wide configuration" },
          { name: "NEET", description: "NEET (UG) rank predictor and the data it uses" },
          { name: "Colleges", description: "Public college directory and college pages (only colleges staff have marked ready)" },
          { name: "News", description: "Admission and counselling notices from official sites, checked and published by staff" },
          { name: "Admin · Auth", description: "Staff login, logout, current user, change password" },
          { name: "Admin · Staff", description: "Staff accounts and roles (ADMIN only)" },
          { name: "Admin · Site", description: "Site settings and disclaimer texts (ADMIN only)" },
          { name: "Admin · Audit", description: "Audit log of staff changes (ADMIN only)" },
          { name: "Admin · Reference", description: "States, countries, official sources and NMC notices (EDITOR or ADMIN)" },
          { name: "Admin · Colleges", description: "Colleges: drafts, Mark ready, fee table, sources, FAQs (EDITOR or ADMIN)" },
          { name: "Admin · Exchange rates", description: "Currency to rupee rates; changing one re-prices every college using it (EDITOR or ADMIN)" },
          { name: "Admin · Imports", description: "Bulk upload of colleges and fees from Excel/CSV, with a preview before saving (EDITOR or ADMIN)" },
          { name: "Admin · NEET", description: "NEET years, cut-offs, score-count upload, preview and publish (EDITOR or ADMIN)" },
          { name: "Admin · News", description: "Official sites watched for admission notices: sources, health, test and fetch-now (EDITOR or ADMIN)" },
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
  .use(collegePublicRoutes)
  .use(newsPublicRoutes)
  .use(authRoutes)
  .use(staffAdminRoutes)
  .use(siteAdminRoutes)
  .use(auditAdminRoutes)
  .use(statesReadRoutes)
  .use(geographyAdminRoutes)
  .use(provenanceAdminRoutes)
  .use(neetAdminRoutes)
  .use(collegeAdminRoutes)
  .use(fxAdminRoutes)
  .use(importsAdminRoutes)
  .use(newsSourceReadRoutes)
  .use(newsAdminRoutes)
  .use(newsReviewRoutes);

provideRouteTable(() => app.routes as never);

export type App = typeof app;
