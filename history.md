# BrightPath Backend History

A running record of rules, decisions and the reasons behind them. Newest session at the bottom of each section. Update this file whenever a decision is made, changed, or a rule is added. Plan itself: [`backendPlan.md`](backendPlan.md).

## Working rules (set by the owner)
| # | Rule | Source |
|---|------|--------|
| R-1 | Plan first in `backendPlan.md`; **no code or migrations until the owner says to proceed** | 2026-11-06 |
| R-2 | Work phase by phase / feature by feature, one at a time, each only on the owner's go-ahead | 2026-11-06 |
| R-3 | Update the OpenAPI docs (`docs/openapi.json` + frontend types via `bun run gen:api`) whenever routes change | 2026-11-06 |
| R-4 | Keep this `history.md` current with important discussions, rules and decisions | 2026-11-06 |
| R-5 | Tech stack is fixed: Bun, Elysia, Prisma 7 / Postgres, BullMQ / Redis, pino, OpenAPI. Not up for debate | 2026-11-06 |
| R-6 | Today's focus is the backend; the frontend design PDF is read only to learn which data the backend must serve | 2026-11-06 |

## Decisions
Format: **ID — decision.** *Why.* Status.

### Owner's answers to planning questions (2026-11-06)
- **D-002 — Data entry through an admin panel API plus CSV import, with an audit log.** Staff must be able to keep ~250 abroad colleges and Indian college data current, with "checked on" dates, without developer help. Chosen over CSV-only scripts and a Google-Sheet source of truth. *Accepted.*
- **D-003 — The owner supplies the official NTA files; rank tables are built from them by a deterministic import.** The PDF promises "same score, same answer" and "official data". *Accepted.* Open: what 2025/2026 files actually contain (see Open questions).
- **D-004 — Enquiries: Postgres first, then BullMQ jobs deliver to Google Sheets (Sheets API) and email (Resend).** PDF §6 requires a Sheet row, an immediate email, and a backup copy so no enquiry is lost. DB is source of truth; each channel retries independently. *Accepted.*
- **D-005 — Plain-words search uses regex/keyword parsing, not Claude/any LLM.** Owner's explicit choice: deterministic, free, no external dependency. Consequence: we need alias dictionaries, a unit-test corpus, and we echo `interpretedAs` chips so users see what was understood. *Accepted.*
- **D-008 — Content pages (countries, states, guides, FAQs, About) live in Postgres and are served by the API; staff log in with roles ADMIN / EDITOR / COUNSELLOR. Students stay anonymous (no student accounts).** Lets staff update content without a frontend deploy. *Accepted.*

### Design decisions I made while planning
- **D-006 — The "Not guaranteed" disclaimer text is stored server-side (versioned) and returned in every rank/college/finder/compare response.** The PDF requires it on every result; one source prevents wording drifting across pages. *Proposed.*
- **D-007 — One `College` table with `kind: INDIA|ABROAD` plus 1:1 profile tables for India-only and abroad-only fields.** The PDF calls it "one growing list" and the finder/compare mix both kinds; separate tables would duplicate search and compare logic. *Proposed.*
- **D-009 — Prisma schema split into multiple files under `prisma/schema/`, one per domain.** The model is large (~30 tables); one file would become hard to review. Requires changing `prisma.config.ts` in Phase 0. *Proposed.*
- **D-010 — Rank predictor and finder runs are not stored per user.** The UI states "We save your score only if you ask a counsellor to call you." Context travels with the enquiry; the server recomputes the rank from the submitted score and never trusts a client-sent rank. Only anonymous aggregate counters are kept. *Proposed.*
- **D-011 — Closing ranks are stored as All-India ranks per (college, year, quota, category, round).** The UI defines closing rank as "the last All-India rank that got a seat", so it compares directly with the predictor's All-India rank range without needing category rank. Category rank is display-only and `null` when the source data does not support it. *Proposed.*
- **D-012 — Finder fit bands: LIKELY (`hi ≤ closing`), CLOSE (closing falls inside the student's range), STRETCH (up to +15%, hidden unless nothing else matches).** Derived from the UI copy "last year's closing rank was higher than your likely rank" and "close call… keep it as a backup". Thresholds are config. *Proposed.*
- **D-013 — Finder gating: locked results are not serialised at all; unlocking uses a stateless signed token returned by `POST /enquiries`.** Prevents scraping the full list from the first response. Free count per group is a setting (default 2, matching the UI). *Proposed.*
- **D-014 — Navigation menus: data-driven parts (countries, college counts, alerts, states) come from `GET /navigation/explore`; plain link menus (NEET UG/PG, Exams) stay in the frontend.** A full CMS menu builder is not needed for v1. *Proposed.*
- **D-015 — Staff auth: email + password (argon2id), opaque server-side sessions in an httpOnly cookie; CSRF via Origin check + custom header. First admin from a bootstrap script.** Simpler to revoke than JWT, fine for a small staff group. *Proposed.*
- **D-016 — Import files stored on local disk in dev and S3-compatible storage in prod.** Needed for re-runs and audit of what built a rank table or catalogue. *Proposed.*
- **D-017 — No automated scraping of mbbsadmissionabroad.in / neetugguidance.in.** PDF §5: facts only, never copy text or design, verify each fact against an official source. The importer accepts a CSV that staff prepare; imported rows start `UNVERIFIED` and cannot be published without sources and checked dates. *Proposed.*
- **D-018 — Rank engine method: exact ties where per-candidate data exists (2024); documented band interpolation only where NTA published mark-range counts.** Always shown as a range; method recorded per year as `basis` and disclosed in the UI. *Proposed; finalised after seeing the files.*
- **D-019 — Phase order: Foundation → Staff auth → Reference data → Rank Predictor → Catalogue/import → Finder/compare → Enquiries → Content → Hardening.** Predictor is a stated priority and needs little else; finder needs the catalogue and closing ranks; enquiries need the finder context. Phases 3 and 4 can swap if NTA files are late. *Proposed.*
- **D-020 — Standard error envelope with per-field messages and a request id.** The enquiry form has an explicit "with mistakes" state ("Please fix 2 things below"), so field errors are part of the API contract. *Proposed.*
- **D-021 — Defaults chosen without asking (may be overturned):** editors can publish (no second-person approval), 24-month enquiry retention, 90-day staleness window, Indian mobile numbers only, no phone OTP, Turnstile feature-flagged off, `nearIndia` as an editable flag on countries. *Proposed.*

### Phase 0 build decisions (2026-11-06)
- **D-022 — Env is parsed once by `parseEnv()` and reports every problem together; `CORS_ORIGIN` accepts a comma-separated list.** A misconfigured deploy should fail at startup with one complete message. *Done.*
- **D-023 — Rate limiter is Redis-backed and fails open if Redis is down; it is mounted after `/health` and `/openapi` so those are never limited.** Elysia hooks only apply to routes registered after them. A cache outage must not take the public site down. Covered by an ordering test. *Done.*
- **D-024 — 404s for unmatched routes are not rate-limited** (the limiter is a `beforeHandle` hook, which only runs on matched routes). Accepted for now; revisit in Phase 8 if scanning noise matters. *Open.*
- **D-025 — Tests run against a separate `brightpath_test` database and Redis db 1; `prepare-test-db.ts` refuses any database name not ending in `_test`.** Protects dev data. *Done.*
- **D-026 — Error handler logs failures once (no duplicate line from the request logger); logs never include query strings; PII keys (`name`, `phone`, `email`, `city`, ...) are redacted.** Plan §3.3 rule 10. *Done.*
- **D-027 — Validation errors return HTTP 422 `VALIDATION_FAILED` with dotted field paths; malformed JSON returns 400 `INVALID_REQUEST`.** *Done.*
- **D-028 — Example job routes/queue/worker removed; the worker process idles until Phase 4/6 register real queues.** *Done.*
- **D-029 — The `pg_trgm` extension is created by a hand-written first migration** (Prisma does not model extensions). *Done.*

### Phase 1 build decisions (2026-11-06)
- **D-030 — No separate `repo.ts` layer yet; services call Prisma directly.** The queries are simple CRUD, and a pass-through repo adds files without value. Introduce repos only where queries get complex (finder, Phase 5). Supersedes the layout sketch in plan §3.2. *Done.*
- **D-031 — Audit is an explicit `audit(tx, entry)` call inside each write's transaction, not a plugin.** A hook cannot know the before/after values or the entity; calling it in the same transaction means the log and the data cannot disagree. Secret keys (`passwordHash`, `token`, ...) are stripped. Supersedes "audit plugin" in plan §5/§8. *Done.*
- **D-032 — No `SESSION_SECRET`.** Sessions are 256-bit random tokens stored only as a SHA-256 hash, so there is nothing to sign. Removed from plan §9. `IP_HASH_SALT` (required in production) and `SESSION_TTL_DAYS` (default 7) added instead. *Done.*
- **D-033 — Roles are not hierarchical: ADMIN passes everything; EDITOR and COUNSELLOR only pass routes that list them.** `staffGuard({ adminOnly | roles })`. *Done.*
- **D-034 — The staff guard uses `derive`, so authentication runs before body validation.** An anonymous caller gets 401, never a field-error hint about an admin endpoint. Tested. *Done.*
- **D-035 — CSRF: every cookie-authenticated write (and login) requires `X-BP-Admin: 1`; if the browser sends an `Origin` it must be in `CORS_ORIGIN`.** The custom header cannot be set by a cross-site form and forces a CORS preflight. Frontend must send it on all non-GET `/admin` calls and use `credentials: "include"`. *Done.*
- **D-036 — Login: same 401 message for wrong password, unknown email and inactive account (unknown emails still pay for a dummy argon2 check); 5 wrong passwords lock the account for 15 minutes (429); 10 login attempts per minute per IP.** *Done.*
- **D-037 — Admin-created and reset accounts have `mustChangePassword`; until changed only `me`, `logout` and `change-password` work (403 `PASSWORD_CHANGE_REQUIRED`).** Admins never know a user's lasting password. Password policy: 12–128 chars, must not contain the email local part or be one repeated character. *Done.*
- **D-038 — Role change or deactivation ends all of that user's sessions immediately; an ADMIN cannot change their own role or active status.** Prevents leaving the system without an admin and makes revocation instant. Password change ends the user's other sessions. *Done.*
- **D-039 — Settings are a code registry (key, description, schema, default, public/private); the DB only stores overrides; unknown keys are rejected; value changes are audited with before/after.** Public settings feed `GET /site/config`; private ones (alert emails, retention, stretch %) never leave the admin API (tested). *Done.*
- **D-040 — Disclaimers are append-only versions; active = highest version; version 0 = built-in default in code.** The required wording exists even on an empty database, and what students saw on any date can be reconstructed. Texts for `NOT_GUARANTEED` (verbatim from the brief), `FOREIGN_COLLEGES_NMC` and `ENQUIRY_CONSENT` (`{brandName}` placeholder). *Done.*
- **D-041 — `GET /site/config` is cached 60 s in Redis (namespace version bumped on every settings/disclaimer write) and served with `ETag`/`Cache-Control`.** Browsers may show a change up to 60 s late; the API itself is fresh immediately. The 304 is not declared in the OpenAPI response map because Elysia's route typing then rejects the `Response` return; it is described in the route text instead. *Done.*
- **D-042 — Audit log paging is cursor-based on the UUIDv7 id (time-ordered).** No offset scans. *Done.*
- **D-043 — Pinned `@sinclair/typebox` as a direct dependency** (used to validate setting values against their schemas; it was only a transitive peer of Elysia). *Done.*
- **D-044 — Prisma 7 `migrate dev` does not regenerate the client; run `bunx prisma generate` after every schema change.** Learned when typecheck failed on a missing model. *Note.*
- **D-045 — Query parameters sent with an empty or whitespace-only value are treated as not provided (global `emptyQueryAsAbsent` plugin, runs before validation). Request bodies are not relaxed.** Found when Apidog sent `?actorId=&limit=&cursor=` and got a 422. Tools and HTML forms commonly send blank filters. Bodies stay strict because an empty password or name is a real error. Owner-approved 2026-11-07. Spec bumped to 0.3.1. Consequence for later phases: an empty `q`/search param means "no search", never "match nothing". *Done.*
- **Process lesson:** a typecheck whose output was compressed in my tooling looked clean but was still failing; always check the exit code (`bun run typecheck; echo $?`). A test-order bug (a test file closing the shared Redis client) was also caught: test files must not close shared connections. *Note.*

### Phase 2 build decisions (2026-11-07)
- **D-046 — Phase 2 is admin-only; the public country/state endpoints stay in Phase 7.** Plan §6.1 puts `GET /countries` and `/counselling/states` in Phase 7, and nothing public needs this data before the catalogue exists. 18 routes under `/admin/states|countries|sources|nmc-notices`, minimum role EDITOR (ADMIN passes, COUNSELLOR refused). Spec 0.4.0. *Done.*
- **D-047 — States and countries are never deleted; slugs cannot be changed.** Colleges will reference them and slugs appear in public URLs. Hide with `State.isLive = false` / `Country.status = COMING_SOON`. Admin paths use the UUID, not the slug. *Done.*
- **D-048 — A source can be deleted only while nothing cites it (409 otherwise); NMC notices can be deleted (audited), but retiring a real notice should use `isActive = false`.** Sources will be cited by fees, closing ranks and colleges, so deletion has to be blocked by the database, not by hope. Today nothing cites a source, so the 409 path is written but cannot yet be exercised; Phase 4 must add a test when the first foreign key to `sources` appears. *Done.*
- **D-049 — NMC notices accept only `scope = COUNTRY` for now; `COLLEGE` returns a field error.** The `collegeId` column exists (so Phase 4 needs no data migration) but has no foreign key until the college table exists. Phase 4 must add the FK and enable `COLLEGE`. *Done; follow-up in Phase 4.*
- **D-050 — Stored links must be http(s); `checkedAt` and `publishedAt` cannot be in the future (one day of slack for time zones).** Links are rendered as hyperlinks, so `javascript:` must never be storable. A future "checked on" date would defeat the provenance rule in PDF §5. Dates may be sent as `2026-10-01` or a full ISO date-time. *Done.*
- **D-051 — Seed inserts only missing rows (`createMany skipDuplicates`), so re-running never overwrites staff edits.** `bun run db:seed` creates 36 states/UTs (8 live: UP, MH, RJ, BR, MP, KA, TN, KL, in that menu order) and 8 countries (Russia, Kazakhstan, Kyrgyzstan, Uzbekistan, Georgia LIVE; Philippines, Nepal, Bangladesh COMING_SOON). `nearIndia` is set only for Nepal and Bangladesh (land neighbours); flight times are left empty because a fact needs a checked source (PDF §5). *Done; see Q-7.*
- **D-052 — `aliases` (lower-case text array) added to State and Country now.** The plain-words search (D-005) needs "up", "kyrgyz", etc.; adding the column later would cost another migration. Seeded conservatively. Parsing logic itself is Phase 5. *Done.*
- **D-053 — Uniqueness (slug/code/ISO code) is checked in the service first and reported as a field error (422), not left to a database error.** Matches the "fix 1 thing below" form contract (D-020). The unique indexes remain as the safety net. *Done.*

### Phase 3 build decisions (2026-11-08)
- **D-054 — Phase 3 was built before any NTA file exists, on a generic score-count CSV (owner chose "build now, load data later").** Upload format is `group,score_from,score_to,candidates` (template: `docs/neet-score-counts-template.csv`). Real NTA files must be converted to it; if their shape surprises us only a small converter is needed, not an engine change. Everything is tested on hand-checkable synthetic fixtures, not real data. Golden-row tests against the real files are still to do (Q-1). *Done; data pending.*
- **D-055 — The rank table is rebuilt from the counts on every upload (no separate "build" step), and `basis` is derived from the data, not typed in.** The table depends only on the counts, so it can never be stale; a year is `BAND_INTERPOLATION` as soon as any count covers a mark range. Supports mixed files (some single scores, some ranges). `?dryRun=true` shows the report without saving. *Done.*
- **D-056 — Mark-range estimates are deliberately honest.** Students in a range are spread evenly over its scores (rounded, deterministic), the estimate is clamped inside the range's rank span, and the response flags `approximate: true` with `possibleRankSpan` (the whole range). Exact years return the exact tied range. A score nobody got returns the single rank it would have taken. *Done.*
- **D-057 — Data is split into groups OVERALL, GENERAL, EWS, OBC, SC, ST, PWD; `categoryRank` and `pwdRank` are `null` unless the year's file has that group (never guessed).** A PwD student qualifies at the lower of their category cut-off and the PwD cut-off. *Done.*
- **D-058 — A score below the qualifying cut-off returns `outcome: "BELOW_CUTOFF"` with all rank fields `null`.** Showing a rank to a non-qualifying score could mislead; the explanation says why. Cut-offs are required to publish, so "unknown" (`qualified: null`) only appears if a category has none. *Proposed; owner may prefer to show the rank anyway.*
- **D-059 — Replaced the plan's `compare=2026|2025|both` parameter with `year` (default newest published) plus an always-present `otherYears[]`.** Works for any number of published years without code changes. *Done; plan §5.1 superseded.*
- **D-060 — NEET admin routes use the year number in the path (`/admin/neet/years/2024`), not a UUID, and a published year is locked.** While published only `checkedAt` and `methodNote` can change; counts, cut-offs, key figures and deletion need an unpublish first (409 otherwise). Prevents live numbers changing without the publish gate. *Done.*
- **D-061 — The score-count file is sent as JSON text (`{csv}`), not stored; its SHA-256, file name and upload time are recorded on the year.** Real file storage and `ImportBatch` (D-016) come in Phase 4. *Done.*
- **D-062 — `tableVersion` = `<year>-<first 12 hex of the SHA-256 of the derived rank table>`.** Same data in, same version out, and every answer carries it. Old tables are not kept: to reproduce an old answer, re-upload the file (its hash is recorded). *Done.*
- **D-063 — Publish gate: the OVERALL counts plus qualifying cut-offs for GENERAL, EWS, OBC, SC and ST (PWD optional).** Cross-checks (counts vs `appeared`, category sums vs overall, topper score) are warnings shown on the year, never blockers: the official files can legitimately disagree. *Done.*
- **D-064 — The first foreign key to `sources` now exists (`NeetExamYear.sourceId`, Restrict), so deleting a cited source returns 409; tested.** Closes the follow-up from D-048. *Done.*
- **D-065 — Public rank answers are cached in Redis (1 hour ceiling, namespace bumped on publish/unpublish/metadata edit) and sent with `ETag` and `max-age=60`.** The disclaimer is attached fresh on every call so a wording change shows at once. Anonymous usage counters (D-010) are not built yet because nothing reads them. *Done.*
- API version 0.5.0: 11 new routes (`GET /neet/rank`, `GET /neet/data-sources`, 9 under `/admin/neet/`). Migration `20261107191841_phase3_neet_rank_data` (additive, 4 tables, 3 enums).

## Discussions and findings
### 2026-11-06 — Planning session
- Read `MBBS-Website-What-We-Build-First.pdf` (4 pages, text) and `MBBS-Previews-v3-Passport.pdf` (18 pages, images only). For the UI PDF I viewed the screens for the menus, rank predictor, college finder, compare, abroad and India college pages, state counselling and enquiry form to extract the data fields. I only skimmed the home, country, guide, about and contact sheets, so their data needs are inferred and should be checked.
- **Access note:** the Read tool is blocked for files outside the project directory (`permissions.blockReadsOutsideWorkingDirectories`). The PDFs are in `~/Downloads`, so I extracted them with `pdftotext` / `pdftoppm` into the job temp directory (`$CLAUDE_JOB_DIR/tmp/pdf`, outside the repo and outside Downloads) and read the outputs. Nothing was written to the repo or Downloads.
- Existing scaffold found: Bun + Elysia app with health and example-job routes, BullMQ worker, pino logging, OpenAPI export script, docker-compose (Postgres 5434, Redis 6381), empty Prisma schema, no migrations. The plan builds on it; the example job code is removed in Phase 0.
- First attempt to ask the owner questions through the structured question dialog was dismissed; I re-asked in plain text and the owner answered **1A, 2A, 3 (Resend + Sheets + regex search), 4A**.
- Files written this session: `backendPlan.md`, `history.md`. No code, no migrations, no OpenAPI changes.

### Findings from the UI PDF that shaped the model
- The rank result shows a **range**, plus category rank, percentile, "students who appeared", and "same score in the other year". The UI explains ties, which is why the engine returns `[from, to]`.
- Finder shows per-college badges: "Recognised by NMC" (India), "Listed in WDOMS", "Meets NMC 2021 rules", "No NMC alert found" / "NMC alert" (abroad), each with a checked date and sources.
- College pages need year-by-year fee tables, foreign currency with FX date, "Sources and dates", FAQs, nearby colleges, eligibility, service bond and stipend (India), closing-rank tables with year/quota/round filters.
- State counselling pages need a runner, seat rules, eligibility, an editable steps timeline (dates blank until the official notice), a college table and FAQs.
- Enquiry form needs field-level errors, a context summary shown to the student, and a "received" confirmation.

## Open questions
| # | Question | Needed by | Current assumption |
|---|----------|-----------|--------------------|
| Q-1 | What exactly did NTA publish for 2024, 2025 and 2026 (per-score counts, mark-range counts, only totals)? Does any file have category-wise data? | Loading real data into Phase 3 | The engine handles both exact and mark-range counts (D-054..D-056); owner supplies the files, then they are converted to the CSV template and golden-row tests are added. `categoryRank` null if not supported |
| Q-2 | Final brand domain for Resend, and whether Turnstile is wanted | Phase 6 | Sandbox sender; Turnstile off |
| Q-3 | Enquiry retention period and who owns deleting rows from the Google Sheet | Phase 6/8 | 24 months, manual Sheet cleanup documented |
| Q-4 | Is a second-person approval needed before publishing college data? | Phase 4 | No, editors publish; audit log covers accountability |
| Q-5 | Hosting target (AWS, VPS, other) | Phase 8 | Host-agnostic Docker deployment |
| Q-6 | Staff and counsellor headcount, and whether counsellors should only see their assigned enquiries | Phase 6 | COUNSELLOR sees all enquiries; assignment is informational |
| Q-7 | Which countries count as "near India" (the PDF example search "under 35 lakh, near India")? Is it land borders, or flight time? | Phase 5 | Only Nepal and Bangladesh are flagged; Central Asian countries and Georgia are not. Editable per country in the admin API |

## Phase log
| Phase | Status | Notes |
|-------|--------|-------|
| 0 Foundation | **Done** (2026-11-06) | Uncommitted. 16 tests pass; spec 0.2.0 exported; CI workflow written but not yet run on GitHub |
| 1 Staff auth, audit, settings | **Done** (2026-11-06) | Uncommitted. 49 tests pass; spec 0.3.0 (16 routes); verified live (bootstrap → login → forced password change → settings → `/site/config`) against the test DB |
| 2 Reference data | **Done** (2026-11-07) | Uncommitted, on branch `feat/backend-phase-2`. 73 tests pass (20 new); spec 0.4.0 (18 new admin routes); migration `20261106193139_phase2_reference_data`; seed verified idempotent against the dev DB |
| 3 NEET Rank Predictor | **Built, awaiting real data** (2026-11-08) | Uncommitted, on branch `feat/backend-phase-3`. 125 tests pass (52 new, synthetic fixtures); spec 0.5.0; migration `20261107191841_phase3_neet_rank_data`. Real NTA files still to load and golden-checked (Q-1) |
| 4 College catalogue + imports | Not started | |
| 5 Finder, closing ranks, compare | Not started | |
| 6 Enquiries (Sheets + Resend) | Not started | Needs Resend + Google credentials |
| 7 Content + navigation | Not started | |
| 8 Hardening + launch | Not started | |
