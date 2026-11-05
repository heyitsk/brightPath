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
