# BrightPath Backend Plan

Status: **Phases 0, 1 and 2 are built (0–1 on 2026-11-06, 2 on 2026-11-07). Phase 3 (rank predictor) is built and the real 2024-2026 NEET figures are loaded as drafts (2026-11-09); publishing waits for the owner. Phases 4–8 are planned only.** Work starts on a phase only when the owner says so. Where the build differs from this plan, `history.md` (D-030 to D-074) is authoritative.
Sources: `MBBS-Website-What-We-Build-First.pdf` (scope, 4 pages) and `MBBS-Previews-v3-Passport.pdf` (UI sheets 00a–12; data fields below are read from the screens).
Companion file: [`history.md`](history.md) records every decision and its reason (IDs like `D-012` are referenced here).

---

## 1. Scope

### In scope (first release)
| # | Part | Backend meaning |
|---|------|-----------------|
| 1 | NEET Rank Predictor | Deterministic score → All-India rank **range** from official NTA data, with year, source and explanation |
| 2 | College Finder | India + abroad matching by rank, category, home state, budget, region; plain-words search; compare 2–3 colleges; result gating until enquiry |
| 3 | College information | One growing, verified, dated catalogue of Indian and abroad colleges |
| 4 | Student enquiries | Save to Postgres → Google Sheet row + Resend email to counsellors, retried; unlock the full finder list |
| 5 | Content for the UI pages | Country pages, state counselling pages, NEET guides, FAQs, About/Contact/legal, navigation menus, site settings (phone/email added later) |
| 6 | Staff admin | Staff login with roles, data entry, CSV import, audit log, enquiry handling |

### Out of scope now (PDF §7)
B2B referral portal, commissions/payments, AI chatbot, separate recognised-colleges directory tool, CRM integration (enquiries must stay exportable so a CRM move is "one step"), NEET PG pages (menu only), student accounts/OTP login.

---

## 2. Stack and existing scaffold

Already in the repo: Bun, Elysia 1.4, `@elysiajs/openapi`, `@elysiajs/cors`, Prisma 7 (`@prisma/adapter-pg`, client output `src/generated/prisma`), Postgres 17 + Redis 7 via docker-compose (host ports 5434/6381), BullMQ + separate worker process, pino logging, `scripts/export-openapi.ts` → `docs/openapi.json` → `frontend/src/api/schema.d.ts` (`bun run gen:api`). Prisma schema is currently empty; no migrations exist.

New dependencies planned (added in the phase that needs them):
| Need | Choice | Phase |
|---|---|---|
| Password hashing | `Bun.password` (argon2id), no dependency | 1 |
| Rate limiting | Redis-backed limiter (small in-repo plugin on `ioredis`) | 0 |
| CSV parsing | `papaparse` or `csv-parse` | 4 |
| Email | `resend` SDK | 6 |
| Google Sheets | `google-auth-library` + plain `fetch` to Sheets REST (smaller than `googleapis`) | 6 |
| Phone validation | in-repo regex (Indian mobiles only, see §7) | 6 |
| Tests | `bun test` | 0 |

---

## 3. Architecture

### 3.1 Process model
- **API** (`src/index.ts`): Elysia, stateless, validates everything with `t.*` schemas, documents every route.
- **Worker** (`src/worker.ts`): BullMQ consumers for enquiry delivery (Sheets, email), CSV imports, cache warming. Separate process, same codebase.
- **Postgres** is the source of truth. **Redis** is for queues, rate-limit counters, public-response cache, and anonymous usage counters. Nothing important lives only in Redis.

### 3.2 Code layout (feature modules)
```
backend/src/
  app.ts, index.ts, worker.ts
  config/env.ts              # typed + validated env; fails fast
  lib/                       # prisma, redis, logger, errors, money, phone, slug, hmac
  plugins/                   # request-id, request-logger, error-handler, rate-limit, auth, cache
  modules/
    <feature>/
      <feature>.routes.ts    # public routes  (tag: feature name)
      <feature>.admin.routes.ts  # /admin/... (staff-only)
      <feature>.service.ts   # business rules, no HTTP
      <feature>.repo.ts      # only where queries are complex (D-030); simple CRUD stays in the service
      <feature>.schemas.ts   # t.* schemas (also drives OpenAPI)
  queues/ workers/           # one file per queue
backend/prisma/schema/       # multi-file schema: one .prisma per domain (D-009)
backend/tests/               # unit + integration
```
The existing `routes/jobs.ts`, `queues/example.queue.ts`, `workers/example.worker.ts` are removed in Phase 0 once the real queue exists.

### 3.3 Cross-cutting rules
1. **Error envelope** (one shape everywhere, documented in OpenAPI):
   `{ "error": { "code": "VALIDATION_FAILED", "message": "Please fix 2 things below.", "fields": [{ "path": "phone", "message": "Enter a 10-digit mobile number. This one has 9 digits." }], "requestId": "…" } }`.
   The enquiry form UI has a "with mistakes" state, so field-level messages are part of the contract, not an afterthought.
2. **Disclaimer is server-owned**: the "Not guaranteed" text is stored once (versioned) and returned in `meta.disclaimer` on every rank/college/finder/compare response so wording can never drift between pages (D-006).
3. **Provenance on every fact**: any number shown to a student has `source` + `checkedAt` (PDF §5 rules). Responses include `sources[]` and `lastCheckedAt`.
4. **Publishing gate**: nothing reaches public endpoints unless `status = PUBLISHED` and the completeness validator passes (sources, dates, required fields). Drafts and imports can never leak.
5. **Money**: INR as integer rupees; foreign amounts keep original currency + FX rate + date (the college page shows "₹1.05 per rouble on 1 Oct 2026"). Lakh formatting is the frontend's job.
6. **IDs**: UUIDv7 primary keys; public URLs use unique slugs.
7. **Pagination**: `limit` (max 100) + `cursor` for lists; finder returns bounded lists.
8. **Caching**: public GETs of published data get `ETag` + `Cache-Control`, and a Redis cache invalidated on publish/import. Rank lookups are indexed single-row reads.
9. **Rate limits**: per-IP on public tools; stricter on enquiry (§7). Admin login is throttled and locked out after repeated failures.
10. **Privacy**: pino redaction for phone/name/email; IPs stored hashed (salted); consent text version stored with each enquiry; DPDP-style erasure/anonymise action for staff (§7, §11).
11. **Audit**: every staff write records actor, entity, action, and before/after diff.
12. **OpenAPI discipline**: see §10.

---

## 4. Data model (Postgres via Prisma, grouped by domain)

Enums are Postgres enums via Prisma. `*At` = timestamptz. All tables have `id`, `createdAt`, `updatedAt`.

### 4.1 Staff and audit (Phase 1)
- `StaffUser(email unique, name, passwordHash, role: ADMIN|EDITOR|COUNSELLOR, isActive, mustChangePassword, lastLoginAt, failedLogins, lockedUntil)`
- `StaffSession(staffUserId, tokenHash, expiresAt, ip hash, userAgent)` — opaque token in httpOnly cookie, only its hash stored
- `AuditLog(actorId, action, entityType, entityId, before JSON, after JSON, at)`
- `SiteSetting(key unique, value JSON, updatedBy)` — business phone, WhatsApp, email, office address, callback hours, counsellor alert emails, finder gate size, enabled NEET years. Phone/email are empty until launch (PDF §6/§8).
- `Disclaimer(key, version, text)` — append-only, active = highest version — the "Not guaranteed" text plus the foreign-colleges/NMC footer text.

### 4.2 Reference and provenance (Phase 2)
- `State(slug, name, code, isLive, sortOrder)` — Indian states/UTs (all, with the 8 starting states marked live first: UP, Maharashtra, Rajasthan, Bihar, MP, Karnataka, Tamil Nadu, Kerala)
- `Country(slug, name, isoCode, status: LIVE|COMING_SOON, nearIndia bool, typicalFlightFromDelhi, sortOrder, content fields — §4.7)`
- `Source(kind: NTA|MCC|STATE_COUNSELLING|NMC|WDOMS|COLLEGE_WEBSITE|OTHER, title, publisher, url, notes)`
- `NmcNotice(title, url, publishedAt, severity: ADVISORY|WARNING, scope: COLLEGE|COUNTRY, collegeId?, countryId?, isActive, checkedAt)` — drives the red "NMC alert" badge and menu "Alert" chip (sheet 00a, 03).

### 4.3 NEET rank data (Phase 3)
- `NeetExamYear(year unique, status: DRAFT|PUBLISHED, appeared, qualified, topperScore, resultDate, basis: EXACT_TIES|BAND_INTERPOLATION, methodNote, sourceId, checkedAt)`
- `NeetQualifyingCutoff(examYearId, category, percentile, minScore)` — needed so "not qualified" is answered honestly and abroad eligibility ("NEET UG: qualified") is computed.
- `NeetScoreDistribution(examYearId, category|OVERALL, scoreFrom, scoreTo, candidates)` — raw import (a per-score row for 2024 full list; per-mark-range rows for 2025/2026 as published)
- `NeetRankRow(examYearId, category|OVERALL, score, rankFrom, rankTo, percentile, candidatesAtScore)` — **derived, one row per integer score** (−180…720 ≈ 900 rows × ~7 categories × years = tiny). Generated by the import job, never hand-edited. Lookup is a primary-key read.
- `ImportBatch` (shared, §4.8) records which files built which year's table.

### 4.4 Colleges (Phase 4)
> **Superseded in part by history.md D-078..D-091 (2026-11-13):** status is `DRAFT|READY|ARCHIVED`; fee lines are one row per year with no FX snapshot (INR is computed from the single `FxRate` per currency); `courseLengthMonths` is on `College`; the ready gate is D-087. The schema as built is `backend/prisma/schema/college.prisma`.

One `College` table, two kinds (D-007):
- `College(slug unique, kind: INDIA|ABROAD, name, shortName?, city, stateId?, countryId, ownership: GOVERNMENT|PRIVATE|DEEMED|TRUST, establishedYear?, description (own words), heroImageUrl?, galleryJSON, status: DRAFT|READY|ARCHIVED (D-079), readyAt, lastCheckedAt (derived), verification: UNVERIFIED|VERIFIED, importBatchId?)`
- `CollegeIndiaProfile(collegeId 1:1, nmcRecognised bool?, nmcRecognitionCheckedAt, mbbsSeats, hospitalName, hospitalBeds?, dailyOutpatients?, serviceBondYears?, serviceBondPenaltyInr?, stipendInr?, domicileRule text, counsellingBodyId)`
- `CollegeAbroadProfile(collegeId 1:1, wdomsListed: LISTED|NOT_LISTED|UNKNOWN, wdomsId?, wdomsUrl?, courseLengthMonths, internshipMonths?, teachingLanguage, languageNote (e.g. "Russian from year 3"), intakeMonths[], seatsForIndians?, minNeet: QUALIFIED|…, eligibility JSON (age rule, class-12 PCB % by category), documents[], flightFromDelhi text?, nmc2021Status: MEETS|DOES_NOT_MEET|UNKNOWN (derived from the booleans below), nmcLengthOk, nmcEnglishOk, nmcInternshipOk)`
- `CollegeFeeLine(collegeId, scope: PER_YEAR|ONE_TIME, yearNumber?, academicYear, tuition, hostel, other, currency, fxRateToInr, fxRateDate, totalInr, sourceId, checkedAt)` — drives "Fees, year by year" and the whole-course total; abroad lines originate in foreign currency.
- `CollegeSourceLink(collegeId, sourceId, purpose: WDOMS|FEE_NOTICE|NMC_NOTICES|NMC_RECOGNITION|SEAT_LIST|COUNSELLING|COLLEGE_WEBSITE, url, checkedAt, checkedBy)` — renders "Sources and dates" and each badge's "checked on".
- `CollegeFaq(collegeId, question, answer, sort)`
- `FxRate(currency, rateToInr, asOf, source)`

Derived at publish time: `totalCourseFeeInr` (denormalised on `College` for fast budget filtering), `lastCheckedAt`, `nmcAlertStatus` (from active `NmcNotice` rows).

### 4.5 Closing ranks and counselling (Phase 5)
- `CounsellingBody(code: MCC|STATE, name, stateId?, website)`
- `ClosingRank(collegeId, year, counsellingBodyId, quota: ALL_INDIA|STATE|MANAGEMENT|NRI|DEEMED, category: GENERAL|EWS|OBC|SC|ST, isPwd, round: 1|2|3|STRAY, closingRank (All-India rank of last admit), seats?, sourceId, checkedAt)`, unique on `(collegeId, year, quota, category, isPwd, round)`.
  The UI defines closing rank as "the last All-India rank that got a seat… lower is harder", so all stored ranks are All-India ranks and compare directly against the predictor output (D-011).
- `StateCounselling(stateId unique, runnerName, runnerUrl, seatsRule text, whoCanApply text, status, updatedAt, sourceId, checkedAt, isPublished)`
- `CounsellingStep(stateCounsellingId, sort, title, description, date? (null until the official notice))`
- `StateCounsellingFaq` → shared `Faq` (§4.7)

### 4.6 Enquiries (Phase 6)
- `Enquiry(name, phoneE164, city, source: FINDER_UNLOCK|PREDICTOR|COLLEGE_PAGE|COMPARE|CONTACT|HEADER_CTA, consent bool, consentTextVersion, consentAt, context JSON (score, category, pwd, aiRankRange, budgetInr, homeStateId, studyPreference, countries[], collegeSlugs[], searchText), pageUrl, ipHash, userAgent, status: NEW|CONTACTED|CALLBACK_SCHEDULED|CLOSED_WON|CLOSED_LOST|SPAM, assignedToId?, isRepeat, repeatOfId?, idempotencyKey unique)`
- `EnquiryDelivery(enquiryId, channel: GOOGLE_SHEET|EMAIL, status: PENDING|SENT|FAILED, attempts, lastError, sentAt, externalRef (sheet row))`
- `EnquiryNote(enquiryId, staffId, body)`

### 4.7 Content (Phase 7)
- Country content (on `Country` or `CountryContent` 1:1): intro, why-study, typical fee range, recognition explainer, admission steps, `lastCheckedAt`, sources.
- `ContentPage(slug, kind: ABOUT|CONTACT|LEGAL|GUIDE|HOW_WE_CHECK, title, summary, body (markdown), seoTitle, seoDescription, status, publishedAt, authorId, lastCheckedAt?)` — guides live at `/neet/[slug]` (sheet 09).
- `Faq(scope: GLOBAL|RANK_PREDICTOR|COLLEGE_FINDER|COUNTRY|STATE|GUIDE|COLLEGE, scopeRefId?, question, answer, sort, isPublished)`
- Menu data (sheet 00a–00e) is **derived** where it is data (countries with live-college counts, top colleges, alert chips, states) and **frontend-owned** where it is just links (NEET UG 2026, Exams). No generic CMS menu builder in v1 (D-014).

### 4.8 Imports (Phase 4)
- `ImportBatch(kind, filename, fileSha256, status: UPLOADED|VALIDATED|COMMITTED|FAILED, stats JSON, errors JSON, createdById, committedAt)` — files stored on local disk in dev and S3-compatible storage in prod (D-016).

### 4.9 Not stored (deliberate)
Rank predictor and finder runs are **not persisted per user**. The UI promises "We save your score only if you ask a counsellor to call you." Only aggregate counters (Redis, daily, no identifiers) are kept for usage stats (D-010).

---

## 5. Business logic

### 5.1 Rank engine (Phase 3)
Input: `score` (integer −180…720), `category` (GENERAL|OBC|SC|ST|EWS), `pwd` bool, `compare` (`2026|2025|both`; default = newest published year).

- **Exact-ties method** (2024 full marks list): rank range for score *s* = `[count(score > s) + 1, count(score ≥ s)]`. This is exactly why the UI shows a *range*: tied candidates are separated by tie-break rules we cannot see.
- **Band-interpolation method** (years where NTA published only mark-range counts, if that is what the files turn out to contain): linear interpolation inside the band, with the range widened to the band's rank span at the extremes. Fixed formula, versioned, disclosed in the "Data we use" table via `basis`.
- Output per year: `allIndiaRank{from,to}`, `categoryRank{from,to}|null` (only when the source data supports it, never guessed), `percentile`, `appeared`, `studentsAhead`, `sameScoreOtherYear{year, from, to}`, `qualified` + cutoff, `basis`, `source{title,url}`, `checkedAt`, plain-words `explanation[]` bullets (template-generated), `disclaimer`.
- Determinism guaranteed: no randomness, no time dependence, pure function of (score, category, pwd, published table version). Response includes `tableVersion` so a result can be reproduced.
- Below-cutoff, out-of-range and unsupported-year inputs return explicit typed outcomes, not 500s.

### 5.2 College Finder engine (Phase 5)
Inputs: `scoreOrRank`, `category`, `pwd`, `homeStateId`, `budgetInr`, `scope: INDIA|ABROAD|BOTH`, `countries[]`, `text`, paging/sort, optional `X-Unlock-Token`.

**India matching.** Student's All-India rank range `[lo, hi]` (from the rank engine, or user-supplied rank as `[r, r]`). For each published India college take the latest-year closing rank for the student's category and eligible quotas: `ALL_INDIA` for everyone, `STATE` only if `college.stateId == homeStateId`; private/deemed quotas by their rule. Fit band, using config constants:
- `LIKELY`: `hi ≤ closingRank` ("last year's closing rank was higher than your likely rank")
- `CLOSE`: `lo ≤ closingRank < hi` ("close call… keep it as a backup")
- `STRETCH`: `closingRank` within `+15%` beyond `hi` (config `finder.stretchPct`), hidden unless nothing else matches
- otherwise excluded. Budget filter on `totalCourseFeeInr`.

**Abroad matching.** Student must be NEET-qualified for their category; filter by `totalCourseFeeInr ≤ budget` and selected countries. Colleges with an active NMC alert **stay in the list but flagged** (PDF screen shows "fits your budget, but NMC has warned students" in red); they sort last.

**Reasons.** Each card returns `reasons[]` as `{code, text}` built from fixed templates in our own words (e.g. `FITS_BUDGET`, `ENGLISH_MEDIUM`, `CLOSING_RANK_ABOVE_YOUR_RANGE`, `NMC_ALERT`). Text is data-driven, never free-form generated.

**Ordering ("sorted by best fit for you").** Deterministic score: fit band → budget headroom → NMC status → closing-rank margin / total fee → name. Ties broken by id so pagination is stable.

**Plain-words search (regex + keywords, no LLM — D-005).** A pure function `parseQuery(text) → {filters, matchedTokens, unparsed}`:
- Budget: `under|below|upto|up to|within|max|<` + number + `lakh|lac|lakhs|l|cr|crore`, or rupee amounts like `₹35,00,000`.
- Scope: `abroad|overseas|foreign` → ABROAD; `in india|govt|government` etc.
- Ownership: `govt|government|private|deemed`.
- Countries/states: alias dictionaries (`kyrgyz` → Kyrgyzstan, `up` → Uttar Pradesh only when standalone and uppercase-tolerant) built from the `Country`/`State` tables plus an alias column.
- `near india` → countries where `nearIndia = true` (editable flag).
- Language: `english` → teaching language filter. Course length: `6 year(s)`. Cheapest/low fees → sort by fee.
- Leftover tokens → trigram/`ILIKE` match on college name/city (Postgres `pg_trgm`, enabled in a raw-SQL migration).
- The response echoes `interpretedAs[]` chips and `unparsed[]` so the UI can show what was understood. **Explicit structured params win over parsed text** when both are present.
- Backed by a table-driven unit-test corpus (the examples in the PDF plus real-world phrasings).

**Gating (PDF: "first results show straight away; full list after name and phone").** Response groups `india` and `abroad` each return `items` (free ones) + `totalMatched` + `locked` count. Locked rows are **not sent** (so they cannot be scraped from the payload). A valid unlock token (§5.4) returns everything. Free count per group is a setting (`finder.freeResultsPerGroup`, default 2 — matches the UI "2 of 6 / 2 of 12").

### 5.3 Compare (Phase 5)
`GET /compare?slugs=a,b,c` (2–3, mixed kinds allowed). Returns an ordered `rows[]` matrix (total fees, tuition/yr, hostel/yr, course length, language, WDOMS, NMC 2021 rules, NMC alert, intake, flight from Delhi, last checked + sources; India rows for closing rank/seats/fees) and per-row `differs: bool` so "Show only what's different" and highlighting need no client logic. Stateless: the share link is just the slugs.

### 5.4 Enquiry pipeline (Phase 6)
1. `POST /enquiries` validates (name, Indian mobile `^[6-9]\d{9}$` → `+91…`, city, consent must be `true` — "Tick this box so we're allowed to call you").
2. **Server recomputes rank from the submitted score** and snapshots the context; client-supplied ranks are never trusted. College slugs are validated against published colleges.
3. Insert `Enquiry` + two `EnquiryDelivery` rows in **one transaction**, enqueue two BullMQ jobs, return `201 {enquiryId, receivedAt, unlockToken?}` immediately. The student never waits on Google or Resend.
4. **Sheets job**: service-account append of one row (columns: enquiryId, receivedAt, name, phone, city, source, score, category, rank range, budget, home state, scope/countries, colleges viewed, page, status). Retries do a lookup on the enquiry-id column first so a timed-out append cannot create a duplicate row. Sheet shared only with counsellors; DB remains the source of truth.
5. **Email job**: Resend to the counsellor list in `SiteSetting`; HTML + text; contains the same context and an admin link.
6. Each channel retries independently (exponential backoff, ~8 attempts); on exhaustion status `FAILED` and it shows on an admin "failed deliveries" list with a one-click requeue. A failure in one channel never blocks the other or the saved enquiry ("Backup copy" requirement).
7. **Idempotency**: `Idempotency-Key` header (double-click safe) + a 10-minute same-phone window returns the existing row; later repeats are stored with `isRepeat=true, repeatOfId`.
8. `unlockToken`: HMAC-signed `{enquiryId, exp}` (30-day TTL), stateless. Sent in `X-Unlock-Token` to the finder.
9. Abuse controls: honeypot field, per-IP limit (5/hour), per-phone limit (3/day), optional Cloudflare Turnstile verification behind a feature flag (off by default; no OTP in v1).

### 5.5 Staff auth and roles (Phase 1)
- Email + password (argon2id), opaque session in an httpOnly, Secure, SameSite=Lax cookie; mutating admin routes also require an `Origin` match + a custom header (CSRF).
- Roles: **ADMIN** (everything incl. users, settings, publish, erasure), **EDITOR** (colleges, fees, ranks, content, imports, publish), **COUNSELLOR** (enquiries only: view, update status, notes). Enforced by a `requireRole()` guard so each admin route declares its minimum role in code and in the OpenAPI `description`.
- First admin created by a one-time bootstrap script from env vars; no default password ever ships.

### 5.6 Publish workflow and verification (Phase 4+)
> **Superseded by history.md D-079 and D-087:** `DRAFT → READY → ARCHIVED`, and "Mark ready" is refused until every required detail is filled (list in D-087). The text below is the original draft.

`DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED`. `publish` runs the validator:
- India: name, state, ownership, NMC recognition status + checked date, seats, at least one `CollegeSourceLink`, fees with source.
- Abroad: country, WDOMS status + checked date, NMC-2021 inputs, NMC-alert check date, fees with FX snapshot, intake, language, at least one source link, plus every source link has `checkedAt`.
- Imported rows arrive `UNVERIFIED` and cannot be published until a human adds official sources (starting lists from mbbsadmissionabroad.in / neetugguidance.in are "starting points" only — PDF §5).
- Admin report `stale`: published colleges whose any `checkedAt` is older than the staleness window (default 90 days; setting).

---

## 6. API surface

Base URL `/`; JSON; errors per §3.3. "Auth" = staff session. Public routes need no login.

### 6.1 Public
| Method & path | Purpose | Phase | OpenAPI tag |
|---|---|---|---|
| `GET /health` | Dependency health (exists) | 0 | Health |
| `GET /site/config` | Contact settings, disclaimer texts, available NEET years, finder gate size, consent text version | 1 | Site |
| `GET /navigation/explore` | Countries with live-college counts, alert flags, top colleges, live states (feeds menu 00a/00b) | 7 | Navigation |
| `GET /neet/rank` | Rank prediction (`score, category, pwd, compare`) | 3 | NEET |
| `GET /neet/data-sources` | "Data we use" table + method notes per year | 3 | NEET |
| `GET /colleges` | Directory/list with filters (kind, country, state, ownership, budget), paging | 4 | Colleges |
| `GET /colleges/{slug}` | Full college page (India or abroad variant) | 4 | Colleges |
| `GET /colleges/{slug}/closing-ranks` | Past closing ranks filterable by year, quota, round | 5 | Colleges |
| `POST /finder/search` | Finder (parsed text + filters, gating) | 5 | Finder |
| `GET /finder/parse?q=` | Debug/preview of plain-words parsing, used for the search-box chips | 5 | Finder |
| `GET /compare?slugs=` | Compare 2–3 colleges | 5 | Compare |
| `POST /enquiries` | Submit enquiry, returns unlock token | 6 | Enquiries |
| `GET /countries`, `GET /countries/{slug}` | Country page data incl. college list and alerts | 7 | Countries |
| `GET /counselling/states`, `GET /counselling/states/{slug}` | State counselling page | 7 | Counselling |
| `GET /pages/{slug}`, `GET /guides`, `GET /guides/{slug}` | About, legal, NEET guides | 7 | Content |
| `GET /faqs?scope=&ref=` | FAQ lists per page | 7 | Content |
| `GET /sitemap` | All public slugs + `updatedAt` for sitemap generation | 7 | Content |

### 6.2 Admin (`/admin/...`, staff only)
| Group | Operations | Min role | Phase |
|---|---|---|---|
| Auth | login, logout, me, change password | any | 1 |
| Users | CRUD, deactivate, reset password | ADMIN | 1 |
| Settings and disclaimers | read/update with versioning | ADMIN | 1 |
| Audit log | list/filter | ADMIN | 1 |
| States, countries, sources, NMC notices | CRUD | EDITOR | 2 |
| NEET years, cutoffs, distribution upload, build/publish rank table | CRUD + job | EDITOR | 3 |
| Colleges (+profiles, fee lines, source links, FAQs, status transitions) | CRUD, publish/unpublish, stale report | EDITOR | 4 |
| Imports | upload → dry-run report → commit; list/rollback batches | EDITOR | 4 |
| Closing ranks | CRUD + CSV import | EDITOR | 5 |
| Enquiries | list/filter/export CSV, detail, status, assign, notes, requeue delivery, anonymise | COUNSELLOR (own/all by role), ADMIN for anonymise | 6 |
| Content (pages, guides, FAQs, state counselling, country content) | CRUD, publish | EDITOR | 7 |

---

## 7. Validation, security and privacy specifics
- **Phone**: Indian mobile only in v1, strip spaces/`+91`/leading `0`, must match `^[6-9]\d{9}$`; stored E.164 (`+91…`). Message wording matches the UI ("Enter a 10-digit mobile number. This one has 9 digits.").
- **Consent**: checkbox text and its version stored with each enquiry (call/WhatsApp consent). Privacy policy page and grievance officer content live in `ContentPage` (footer links exist on every screen).
- **Retention** (default, to be confirmed with the owner): enquiries are kept 24 months, then anonymised by a scheduled job; staff can anonymise earlier on request. The Google Sheet is a copy and has to be cleaned manually or by the same job (documented risk).
- **Secrets** only in env (never committed): see §9.
- **Headers/CORS**: strict allow-list CORS from `CORS_ORIGIN`, security headers, body size limits (1 MB JSON; imports capped at 10 MB).
- **Logging**: request id on every log line; PII redaction list; no request bodies logged for `/enquiries` or `/admin/auth`.
- **SQL safety**: Prisma parameterisation; the single raw-SQL trigram query uses bound parameters.

---

## 8. Phases

Each phase ends **shippable and demo-able**: migrations applied, tests green, `docs/openapi.json` regenerated, `history.md` updated, committed as its own commit (or PR). A phase starts only on the owner's go-ahead.

### Phase 0 — Foundation
- Remove example jobs; restructure into `modules/`, `plugins/`, `lib/`.
- Typed, validated `config/env.ts` (all env names in §9, with `.env.example` updated).
- Switch Prisma to multi-file schema folder; set up `prisma.config.ts`, first empty-domain migration, `pg_trgm` extension migration; seed script scaffolding.
- Plugins: request-id, error envelope + validation-error mapper, Redis rate limiter, cache/ETag helper, pino redaction.
- `bun test` harness with a throwaway test database; a CI workflow (typecheck, tests, OpenAPI freshness check).
- OpenAPI conventions locked (see §10); version `0.1.0` → `0.2.0` after this phase.
- **Done when:** `/health` passes, error envelope is shown in OpenAPI, CI is green, `gen:api` is a no-op diff.

### Phase 1 — Staff auth, audit, settings
- Tables §4.1; login/logout/me; role guard; lockout; first-admin bootstrap script; audit plugin; settings + disclaimers admin and `GET /site/config`.
- **Done when:** an ADMIN can log in, create an EDITOR and a COUNSELLOR, edit settings; role checks have tests; every write appears in the audit log.

### Phase 2 — Reference data and provenance
- States (all India), countries (the 8 starting ones, 5 LIVE + 3 COMING_SOON), sources, NMC notices; admin CRUD; seed data for the starting lists.
- **Done when:** starting states/countries exist via seed, editors can manage sources and notices.

### Phase 3 — NEET Rank Predictor (first of the two priority tools)
- Tables §4.3; admin upload of official NTA files, validate, build derived `NeetRankRow` table (dry-run diff before publish); `GET /neet/rank`, `GET /neet/data-sources`.
- Rank engine unit tests: ties, boundaries (720, qualifying cutoff, negative), per-category, both years, determinism (same input → byte-identical output).
- **Blocked on data:** needs the official NTA files from the owner (see §12).
- **Done when:** a known 2024 score reproduces the expected range from the source file, response carries source/year/disclaimer/explanation, and the frontend types are regenerated.

### Phase 4 — College catalogue and import pipeline
- Tables §4.4, §4.8; admin CRUD with status workflow and validator; CSV import (dry-run → commit, row-level errors, idempotent re-import by slug); `GET /colleges`, `GET /colleges/{slug}`; stale report.
- Seed the starting list: Russia, Kazakhstan, Kyrgyzstan, Uzbekistan, Georgia (then Philippines, Nepal, Bangladesh as COMING_SOON) and the 8 starting states — as `DRAFT/UNVERIFIED` until checked.
- **Done when:** an editor can import a CSV, review, add sources, publish a college, and the public page endpoint returns it with sources and dates; an unverified college returns 404 publicly.

### Phase 5 — College Finder, closing ranks, compare
- Tables §4.5 (closing ranks first; counselling pages in Phase 7); closing-rank CSV import; finder engine, text parser, gating, reasons, compare; `GET /colleges/{slug}/closing-ranks`.
- Tests: table-driven query-parser corpus, fit-band boundaries, gating (locked items absent from payload), stable ordering, budget edge cases.
- **Done when:** the PDF's example ("MBBS under 35 lakh, near India") parses to the expected filters, results are deterministic, and the free/locked split matches the UI.

### Phase 6 — Enquiries (Sheets + Resend)
- Tables §4.6; `POST /enquiries`, unlock token, BullMQ delivery queues/workers, Sheets + Resend adapters (interface + fake for tests), admin enquiry screens' API, failed-delivery requeue, rate limits/honeypot, anonymise action.
- **Needs from the owner:** Resend account + verified sending domain, Google Cloud service account and the Sheet shared with it, counsellor alert email list (see §12).
- **Done when:** a test enquiry produces a DB row, a Sheet row and an email; killing Google/Resend mid-flight leaves the enquiry saved and later delivered by retry; duplicate submit creates one row; unlock token reveals the full finder list.

### Phase 7 — Content and navigation
- Tables §4.7 + `StateCounselling`/`CounsellingStep`; country/state/guide/page/FAQ endpoints; `GET /navigation/explore`; `GET /sitemap`; admin CRUD with publish.
- **Done when:** every UI sheet (01–12) has all of its data available from an endpoint documented in OpenAPI.

### Phase 8 — Hardening and launch readiness
- Cache invalidation review, rate-limit tuning, security checklist (headers, CORS, cookies, dependency audit), backups and restore test, load test of finder/rank endpoints, runbook (failed deliveries, rotating secrets, data refresh each counselling season), deployment config, monitoring/alerting hooks.
- **Done when:** a written launch checklist is signed off.

### Phase 9 — News tool (added 2026-11-21; built next at the owner's request, independent of Phases 5–8)
- Full design in §15. Steps, each on its own go-ahead: **N1** (done 2026-11-21) schema + source registry + fetch/extract framework + RSS and WordPress adapters + worker + probe script; **N2** (done 2026-11-21) HTML reader and settings for the server-rendered sites, with saved-page tests; **N3** review queue API (approve / edit / reject / unpublish, bulk actions, audit) + public `GET /news`; **N4** relevance rules, dedupe, source health and alerts; **N5** (optional) headless-browser fetcher for the 3 or 4 JavaScript-only sites.
- **Done when:** a new notice appearing on a source site shows up in the admin review queue within one fetch cycle, an editor can fix its wording and publish it, it appears on `GET /news` with a link to the official original, and a broken source is visible in the admin source list.

Suggested order is by dependency and by priority (rank predictor before finder). Phases 3 and 4 are independent and could swap or run in parallel if the NTA files arrive late.

---

## 9. Configuration (env)
`NODE_ENV, PORT, LOG_LEVEL, CORS_ORIGIN, DATABASE_URL, REDIS_URL` (exist) plus:
`UNLOCK_TOKEN_SECRET, IP_HASH_SALT, SESSION_TTL_DAYS, ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, RESEND_API_KEY, EMAIL_FROM, GOOGLE_SERVICE_ACCOUNT_JSON_B64, GOOGLE_SHEET_ID, GOOGLE_SHEET_TAB, TURNSTILE_SECRET (optional), STORAGE_* (imports/media), PUBLIC_SITE_URL`.
Counsellor alert emails and finder gate size are **settings in the DB**, not env, so staff can change them without a deploy.

---

## 10. OpenAPI and frontend contract rules
1. **Every route** declares `detail.summary`, `detail.description`, a `tags` entry, and `t.*` schemas for params/query/body and **every** response status including the error envelope. Fields carry `description`; examples where useful (e.g. the PDF's rank example).
2. Admin routes mention required role in their description and are grouped under `Admin · <area>` tags.
3. After any route change: `bun run gen:api` (writes `docs/openapi.json` and `frontend/src/api/schema.d.ts`). The regenerated files are committed with the code.
4. CI fails if `docs/openapi.json` is stale versus the code.
5. API version in `app.ts` bumps per phase (`0.2.0`, `0.3.0`, …) and the description lists what changed; breaking changes after launch need `/v1` prefixing.
6. Tags registered in `app.ts` (Health, Site, NEET, Colleges, Finder, Compare, Enquiries, Countries, Counselling, Content, Navigation, Admin · …).

---

## 11. Testing and quality
- **Unit**: rank engine, fit bands, query parser, phone/money helpers, validators, derived NMC status.
- **Integration**: Elysia `app.handle()` against a real Postgres + Redis (docker), covering auth/role matrix, publish gate, import dry-run/commit, enquiry transaction, queue consumers with fake Sheets/Resend adapters.
- **Contract**: OpenAPI export is deterministic and diffed in CI.
- **Data tests**: golden rows from the real NTA files (a handful of known score → rank checks) so a bad import is caught before publish.
- `typecheck` and tests run on every push; migrations are linted for destructive changes.

---

## 12. Inputs needed from the owner (not blockers for planning)
| Item | Needed by | Notes |
|---|---|---|
| Official NTA files: 2024 marks list; 2025 and 2026 result totals / mark-range distributions, category-wise qualifying cut-offs | Phase 3 | I cannot finalise the 2025/2026 method (exact vs interpolation) until I see exactly what NTA published |
| Whether the source files contain **category-wise** data | Phase 3 | If not, `categoryRank` is returned as `null` rather than estimated |
| Resend account + sending domain (needs the final brand domain) | Phase 6 | Until then emails go to a sandbox sender |
| Google Cloud project + service account JSON + the counsellors' Sheet shared with it | Phase 6 | Sheet column layout in §5.4 |
| Counsellor alert email list, business phone/WhatsApp/email, callback hours | Phase 6/8 | PDF says added after the site is built |
| Privacy policy, terms, grievance officer details | Phase 7 | Legal text is not written by the backend |
| Hosting target and domain | Phase 8 | Plan is host-agnostic (Docker + Postgres + Redis) |

## 13. Risks and how the plan handles them
| Risk | Mitigation |
|---|---|
| 2025/2026 NTA data less granular than 2024, so rank ranges are wider or approximated | Method recorded per year (`basis`), disclosed in the UI, never presented as exact; range shown, not a point |
| Wrong or stale fees/closing ranks = real harm to students | Mandatory source + `checkedAt`, publish gate, stale report, disclaimer on every payload |
| Copying competitor data (PDF forbids copying text/design) | Import accepts facts only; descriptions are written by staff; imported rows start `UNVERIFIED`; no scraping of competitors. The news tool (§15) reads only the official government sites the owner listed and never publishes without a staff click |
| News scraper breaks silently when a government site changes its layout | Per-source health (last success, items found, consecutive failures); "0 items where there used to be many" raises a warning; saved-HTML fixture tests per site; sources are editable data, not code (§15) |
| A wrong or misread notice reaches students | Nothing auto-publishes; staff write or edit the summary; every item links to the official original with "published on" and "checked on" dates (§15) |
| NMC/WDOMS wording errors | Terms fixed in an enum/label dictionary served by the API: "Recognised by NMC" (India only); "Listed in WDOMS", "Meets NMC 2021 rules", "NMC alert" (abroad) |
| Google Sheets or Resend outage | Enquiry saved first; per-channel queue retries; failed-delivery list; no student-visible failure |
| Duplicate/spam enquiries | Idempotency key, honeypot, rate limits, optional Turnstile, repeat flag |
| PII in a Google Sheet and in email | Sheet restricted to counsellors, log redaction, retention job, anonymise action |
| Finder scraping of locked results | Locked rows are not serialised at all |
| Vite SPA is weak for SEO | Not a backend problem, but the API provides `/sitemap`, SEO fields and stable slugs; frontend may need prerendering later (flagged, not decided) |
| Local disk was at 100% earlier in this project | Keep DB/Redis volumes small in dev; `docker system prune` before heavy work |

---

## 14. Defaults I chose without asking (owner may overturn; all logged in `history.md`)
Staff login by email+password with sessions (not JWT); editors may publish (no second-person approval); 24-month enquiry retention; 90-day staleness window; free finder results = 2 per group; stretch band = +15%; no phone OTP and Turnstile off by default; Indian mobile numbers only; imports stored locally in dev and S3-compatible in prod; menu links stay in the frontend.

---

## 15. News tool (Phase 9)

### 15.1 What it does
Watches the official admission/counselling sites the owner listed, turns each new notice into a **candidate** in an admin review queue, and lets counsellors or editors verify, reword and publish it to a public News page. Happy path: a state site posts a counselling notice → within a few hours it is in the queue → staff open it, check it against the original, fix the wording, click publish → it is live on `/news` (and filterable by state).

### 15.2 What I found by probing the 30 sites (2026-11-21, from the dev machine)
| Finding | Count / sites | Consequence |
|---|---|---|
| Working feed that carries real notices | Only `amruhp.ac.in` (Himachal; RSS and WordPress JSON both work). `cetcell.mahacet.org` has a valid but **empty** feed; `knruhs.telangana.gov.in`'s feed lists site pages ("Physiotherapy", "Hello world!"), not notices. `mcc.nic.in`, `neet.nta.nic.in`, `ojee.nic.in`, `wbmcc.nic.in` are WordPress with the JSON API switched off and `/feed/` erroring (all tested in N1) | RSS and WordPress adapters (N1) serve one live source; the HTML reader (N2, built) serves 19 more. An earlier version of this table over-counted feeds |
| Server-rendered HTML notice lists (no feed) | about 21 sites, e.g. Bihar, Haryana, Tamil Nadu, Kerala, Goa, Jharkhand, J&K, Meghalaya, Tripura, UP, Assam, Telangana, Pondicherry, AP DHTE | HTML adapter with per-site selectors and a generic fallback |
| JavaScript-rendered or near-empty pages | `bfuhs.ac.in`, `medadmgujarat.org`, `mc.mizoram.gov.in`, `dme.mponline.gov.in` | Need a headless browser (N5) or the site's hidden JSON endpoint; postponed |
| Unreachable | `ntruhs.ap.nic.in`, `hpupshimla.in` (domain does not resolve), `kea.kar.nic.in` (times out; may only answer Indian IPs), `education.rajasthan.gov.in` (old TLS renegotiation, needs a special client setting), `dtenagaland.org.in` (HTTP 410 Gone) | **Owner replied 2026-11-21 with replacements** for AP (`drntr.uhsap.in/index/`), HP (`hpsmc.org`) and Nagaland (`nmc.nagaland.gov.in`); all three respond. KEA and Rajasthan to be re-tested from the deployed host |
| Notices are noisy | Same pages mix MBBS with PG, BAMS/BHMS, nursing, recruitment, tenders, COVID-era archives | Relevance scoring and a "Filtered" tab (§15.5) |
| Dates are usually not in the link text | Only a minority of links carry a date | Date comes from the page row, the PDF, or `firstSeenAt` as the fallback; the item always shows which one |
| One site lists 1,000+ links on a page (`centacpuducherry.in`) | | First-run baseline cap (§15.6) so staff are not flooded |

### 15.3 Tools and libraries
No paid API or third-party scraping service is needed. Everything fits the existing stack (Bun, Elysia, Prisma, BullMQ/Redis, pino):
- **Fetch:** Bun `fetch` with timeouts, identifying User-Agent, conditional GET (ETag / If-Modified-Since), per-host rate limit.
- **HTML parsing:** `cheerio` (CSS selectors, no browser). **Feeds:** `fast-xml-parser` (RSS/Atom). **WordPress:** `/wp-json/wp/v2/posts` JSON.
- **Scheduling:** BullMQ repeatable jobs in the existing `worker.ts` (default every 3 hours per source; a setting to go hourly in counselling season).
- **Later, only if needed:** `playwright` in a separate worker image for JS-only sites (N5); a PDF text reader to pull a date/title from a notice PDF.
- **Not used:** an LLM (consistent with the plain-words search rule, D-rule in `history.md`); hosted services such as RSS.app, PageCrawl or changedetection.io (they detect page-level changes, not a clean list of new notices, add cost or another service to run, and would sit outside the review model). Revisit only if in-house parsing proves too costly to maintain.

### 15.4 Data model (new tables; migration in N1)
- `NewsSource(id, name, stateId?, kind: RSS|WP_REST|HTML_LIST|HTML_JS, listUrl, config JSON (item/link/date selectors, date format, URL prefix, TLS-legacy flag), isActive, fetchIntervalMin, lastRunAt, lastSuccessAt, lastItemCount, consecutiveFailures, lastError, status: OK|DEGRADED|BROKEN)` — admin-editable, so fixing a selector or adding a site needs no deploy.
- `NewsItem(id, sourceId, stateId?, title, originalUrl, urlHash UNIQUE with sourceId, publishedAt?, publishedAtBasis: SOURCE|PDF|FIRST_SEEN, firstSeenAt, relevanceScore, category: COUNSELLING|SCHEDULE|SEAT_MATRIX|MERIT_LIST|REGISTRATION|RESULT|FEE|OTHER, status: PENDING|PUBLISHED|REJECTED|FILTERED|BASELINE|UNPUBLISHED, summary (staff-written), publicTitle?, isPinned, reviewedById, reviewedAt, publishedById, publishedAt, slug)`.
- `NewsFetchRun(id, sourceId, startedAt, durationMs, httpStatus, itemsFound, itemsNew, error)` — trimmed after 30 days.
- Reuses `State` (a source belongs to a state), `StaffUser`, the audit log, and the settings registry.

### 15.5 Pipeline
1. **Fetch** a source (respecting its interval, robots.txt, one request at a time per host, 15 s timeout, exponential back-off).
2. **Extract** candidates `{title, url, date?}` using the source's adapter. A generic harvester (links whose text matches counselling words, PDF links, dated rows) is the fallback for sites with no tuned selectors.
3. **Normalise** URLs (absolute, no tracking params, no fragments) and compute `urlHash`; a repeat in the same source is skipped. Same title + same PDF name under a new URL is flagged as a likely repeat, not dropped.
4. **Score** with plain keyword rules: positives (MBBS, UG, NEET, counselling, allotment, seat matrix, merit list, round, choice filling, registration, schedule), negatives (PG, MD/MS, BAMS, BHMS, nursing, B.Sc, recruitment, tender, COVID, archive). Title-and-link only, no LLM. Category is assigned by the same rules. Low-score items go to `FILTERED`, which is a visible tab, so nothing is silently lost and the rules can be tuned from real misses.
5. **Queue**: the rest become `PENDING` and appear in the admin review list. Optional email/dashboard badge for counsellors when new items arrive.
6. **Review**: staff open the original, optionally edit `publicTitle`, write a 1–2 line `summary`, set category/state/pin, then **Publish** or **Reject**. Published items can be unpublished. Every action is audited.
7. **Public**: `GET /news` (paginated; filters `state`, `category`; newest first, pinned first) and `GET /news/{slug}`. Each item shows the source name, "Published on" (with its basis), "Checked on", and a link to the official original. The site does not mirror or host the PDFs.

### 15.6 Rules that protect quality
- **Nothing auto-publishes.** Ever. (Matches the college ready-gate philosophy.)
- **First-run baseline:** the first successful fetch of a source marks everything older than 60 days, and anything beyond the newest 20, as `BASELINE` (hidden, searchable), so a 1,000-link page does not create 1,000 tasks.
- **Source health:** `DEGRADED` after 3 failures, `BROKEN` after 10 or when a source that returned items now returns 0 for 3 runs. Admin source list shows the status and last error; a settings-defined alert email is notified on `BROKEN`.
- **Politeness:** identifying User-Agent with a contact address (env), robots.txt honoured, minimum 5 s between requests to one host, nothing heavier than the list page plus conditional GETs.
- **Staff-written summaries:** we link to and summarise official notices; we do not copy their text wholesale.
- **Dates are honest:** `publishedAtBasis` says whether the date came from the source, the PDF or our first sighting.
- **Sites read without certificate checks (owner decision, 2026-11-21):** `apdhte.nic.in` (expired certificate) and `dmer.haryana.gov.in` (incomplete certificate chain) are read with `config.allowInsecureTls = true`, for those two sources only. Trade-off: a person on the network path could slip a fake notice into the review queue. Why it is accepted: these are public notice pages, nothing is sent to them, every notice is checked by staff against the official page before publishing, and published items link to the official original. If either site fixes its certificate, switch the setting off.
- **Sources switched off on purpose (owner decision, 2026-11-21):**
  - `neet.nta.nic.in` (NTA): the site answers our bot with HTTP 403 although a normal browser is let in. The bot identifies itself honestly and will not pretend to be a browser, so this source stays off. Its settings are ready; to turn it on, get NTA to allow the bot (or find another official route) and switch the source on. Revisit if NTA notices are needed sooner; NTA results are in any case followed by MCC and the states.
  - `telangana-knruhs`: its feed lists site pages, not notices.
  - `karnataka-kea`: the site is under maintenance; switch on when it is back.
  - Nine JavaScript-driven sites (Gujarat, Madhya Pradesh, Mizoram, Punjab, Rajasthan, Assam, MCC, West Bengal MCC, UP): **wait for step N5** (owner decision).
- **Frontend is not touched while the backend is built (owner decision, 2026-11-21).** `docs/openapi.json` is kept up to date, but the generated types in `frontend/src/api/schema.d.ts` are not regenerated until the frontend work begins. (The N1 commit did include one regeneration of that file.)

### 15.7 Admin API (Admin · News; role to confirm, default COUNSELLOR and above for review, EDITOR and above for sources)
`GET /admin/news` (filters: status, state, category, source, search, `isNew`) · `GET /admin/news/{id}` · `PATCH /admin/news/{id}` (edit wording, category, state, pin) · `POST /admin/news/{id}/publish|reject|unpublish|restore` · `POST /admin/news/bulk` (reject/restore many) · `GET/POST/PATCH/DELETE /admin/news/sources` · `POST /admin/news/sources/{id}/test` (dry run: fetch + extract, show what would be found, store nothing) · `POST /admin/news/sources/{id}/run` (fetch now) · `GET /admin/news/sources/{id}/runs` · `GET /admin/news/stats` (pending count per state, broken sources).
Public: `GET /news`, `GET /news/{slug}`, plus `latestNews` (top 3) added to the homepage/state-page payloads when the frontend wants it.

### 15.8 Testing
Saved HTML/RSS snapshots of every onboarded site as fixtures (no live network in tests); one contract test per adapter; table-driven corpus for relevance scoring; dedupe, baseline and health-state tests; publish-flow and role matrix tests; a `bun run news:probe <source>` script for live checks by hand.

### 15.9 Config
Env: `NEWS_USER_AGENT`, `NEWS_CONTACT_EMAIL`, `NEWS_MIN_HOST_DELAY_MS`. Settings in the DB: default fetch interval, "counselling season" fast interval, alert email, relevance threshold, baseline limits.

### 15.10 Central sources added by the owner (2026-11-21)
`mcc.nic.in` (WordPress; JSON API disabled and `/feed/` errors, tested in N1, so HTML adapter), `neet.nta.nic.in` (WordPress, ~49 notice links, 43 PDFs, about half dated; the best-structured of all), `nmc.org.in` (not WordPress, `/feed/` and `/wp-json` both 404, so HTML adapter). These are central sources (no state). With Nagaland dropped by the owner (2026-11-21), the registry holds **32 sources**. After N2: **20 switched on** (Himachal's feed and 19 web pages read live on 2026-11-21); off: Telangana's feed (lists pages, not notices), NTA (answers our bot with HTTP 403), Karnataka (site down), and 9 JavaScript pages waiting for N5 (Gujarat, Madhya Pradesh, Mizoram, Punjab, Rajasthan, and Assam, MCC, WBMCC, UP found to be JavaScript-driven in N2).

### 15.11 Replacement sources: what they turned out to be
- `drntr.uhsap.in/index/` (Andhra Pradesh): server-rendered, about 140 notice links, mostly PDFs, mixed with PG; works with the HTML adapter.
- **Update 2026-11-21 (second reply):** Himachal is now `amruhp.ac.in` (Atal Medical and Research University; WordPress, about 236 notice links, 180 PDFs, MBBS/BDS prospectus and counselling links), replacing `hpsmc.org`, which is dropped. Rajasthan is now `medicaleducation.rajasthan.gov.in/home`, which is JavaScript-rendered (no links in the raw page), so it joins the N5 group. Karnataka (`kea.kar.nic.in`) is under maintenance: registered but `isActive = false` until it is back. Andhra Pradesh stays on `drntr.uhsap.in` (it works).
- `hpsmc.org` (dropped) and `nmc.nagaland.gov.in` (kept as given, still unconfirmed): from their link text ("Provisional Registration", "Registration Rules", "Re-registration", "Election Notification") these look like the **state medical councils** (doctor registration), not the admission and counselling bodies. They will mostly produce notices that the relevance rules filter out. Kept as sources as given; owner asked to confirm whether the actual HP and Nagaland counselling sites are wanted instead.
