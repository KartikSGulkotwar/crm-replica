# CRM Replica

A customizable, metadata-driven CRM: keep companies, people and deals, and change the data model
itself (custom objects, fields, saved views, workflows and an AI agent).

> Inspired by [Twenty](https://github.com/twentyhq/twenty) (twentyhq/twenty). Independent
> implementation; no Twenty code used.

**Status:** Phase 1 of 12 (scaffold). See [TWENTY_SPEC.md](TWENTY_SPEC.md) for the full plan.

## What's in the repo

| Path              | What it is                                                                   |
| ----------------- | ---------------------------------------------------------------------------- |
| `apps/server`     | NestJS API (`/api`), OpenAPI docs at `/api/docs`, serves the web app in prod |
| `apps/worker`     | BullMQ worker process; reuses the server's compiled modules                  |
| `apps/web`        | React 18 + Vite + Tailwind + TanStack Query                                  |
| `packages/shared` | Types and constants shared by everything (`FieldType`, queue names, …)       |

## Local setup (macOS)

Requirements: Node 22+ (24 recommended), pnpm 11, Docker Desktop.

```bash
cp .env.example .env        # defaults match docker-compose.yml
pnpm install
docker compose up -d        # Postgres on :5432, Redis on :6379
pnpm dev                    # API :3000, web :5173, worker, all with live reload
```

Open http://localhost:5173. The **System status** card shows the API, database, Redis and worker.

Run everything in Docker instead (production-like, one URL on :3000):

```bash
docker compose --profile full up --build
```

## Scripts

| Command          | Does                                                          |
| ---------------- | ------------------------------------------------------------- |
| `pnpm dev`       | Builds dependencies once, then runs all apps in watch mode    |
| `pnpm test`      | All tests. Server e2e tests need `docker compose up -d` first |
| `pnpm lint`      | ESLint                                                        |
| `pnpm typecheck` | TypeScript in every package                                   |
| `pnpm build`     | Production build of every package                             |
| `pnpm format`    | Prettier                                                      |

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests (with Postgres and Redis
service containers) and build, and checks that the Docker image builds.
