# BrightPath

| Part | Stack |
| --- | --- |
| `backend/` | Bun, Elysia, Prisma 7 (Postgres), BullMQ (Redis), pino logging, OpenAPI |
| `frontend/` | Vite, React, TypeScript, Tailwind CSS v4 |
| `docker-compose.yml` | Postgres 17 + Redis 7 for local development |
| `docs/openapi.json` | Generated API contract the frontend builds against |

## Setup

```bash
cp .env.example .env                       # docker-compose vars
cp backend/.env.example backend/.env       # then make DATABASE_URL / REDIS_URL passwords match .env
cp frontend/.env.example frontend/.env

bun run install:all
bun run infra:up
cd backend && bun run db:generate
```

Host ports are intentionally non-standard (Postgres **5434**, Redis **6381**, API **4000**) to avoid clashing with local services. Change them in the `.env` files if needed.

## Running

```bash
bun run dev:backend     # API on http://localhost:4000
bun run dev:worker      # BullMQ workers (separate process)
bun run dev:frontend    # Vite on http://localhost:5173
```

## API docs (OpenAPI)

- Interactive docs: <http://localhost:4000/openapi>
- Raw spec: <http://localhost:4000/openapi/json>
- Committed contract: [`docs/openapi.json`](docs/openapi.json)

After changing backend routes, regenerate the spec and the frontend types:

```bash
bun run gen:api    # writes docs/openapi.json and frontend/src/api/schema.d.ts
```

Document every route with `detail: { summary, description }` and `t.*` schemas (with `description`s) so the spec stays useful to the frontend.

## Logging

Console only, via pino. Pretty output in development, JSON lines when `NODE_ENV=production`. Control verbosity with `LOG_LEVEL`.

## Secrets

`.env` files are git-ignored at the root, in `backend/` and in `frontend/`. Commit only the `.env.example` templates.

## Backend conventions (see `backendPlan.md` and `history.md`)

- Code is organised in feature modules under `backend/src/modules/<feature>/`; shared plumbing is in `src/lib` and `src/plugins`.
- Every non-2xx response uses `{ error: { code, message, fields?, requestId } }`. Throw `AppError` from services; never build error bodies by hand.
- The Prisma schema is a folder (`backend/prisma/schema/*.prisma`), one file per domain.
- Tests: copy `backend/.env.test.example` to `backend/.env.test`, then `cd backend && bun run test`. It creates and migrates a separate `*_test` database; it refuses to touch any other.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests and fails if `docs/openapi.json` or the generated frontend types are stale.

## Staff admin API (Phase 1)

First admin (one time, after `bun run infra:up` and `cd backend && bunx prisma migrate deploy`):

```bash
cd backend
ADMIN_BOOTSTRAP_EMAIL=you@example.com ADMIN_BOOTSTRAP_PASSWORD='a-long-temporary-passphrase' bun run admin:bootstrap
```

Log in via `POST /admin/auth/login`; you must change the temporary password before anything else works. Frontend rules: send `credentials: "include"` and the header `X-BP-Admin: 1` on every non-GET `/admin/*` request. Set `IP_HASH_SALT` to a long random value in production.
