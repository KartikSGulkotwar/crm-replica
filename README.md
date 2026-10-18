# CRM Replica

A customizable, metadata-driven CRM: keep companies, people and deals, and change the data model
itself (custom objects, fields, saved views, workflows and an AI agent).

> Inspired by [Twenty](https://github.com/twentyhq/twenty) (twentyhq/twenty). Independent
> implementation; no Twenty code used.

**Status:** Phase 2 of 12 (auth & workspaces). See [TWENTY_SPEC.md](TWENTY_SPEC.md) for the full plan.

## Done so far

- **Phase 1:** monorepo, API, worker, web app, Docker, CI, live health check.
- **Phase 2:** sign up (creates a workspace with its own Postgres schema, `workspace_<id>`, and
  makes you admin), log in / log out with an httpOnly JWT cookie, admin and member roles, one
  invite link per workspace (admins can reset it), Settings → General and Members, rate-limited
  auth endpoints.

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

Open http://localhost:5173 and click **Create a workspace**. The API runs database migrations on start.

Run everything in Docker instead (production-like, one URL on :3000):

```bash
docker compose --profile full up --build
```

## Scripts

| Command          | Does                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`       | Builds dependencies once, then runs all apps in watch mode                                     |
| `pnpm test`      | All tests. Server e2e tests need `docker compose up -d` and use a separate `crm_test` database |
| `pnpm lint`      | ESLint                                                                                         |
| `pnpm typecheck` | TypeScript in every package                                                                    |
| `pnpm build`     | Production build of every package                                                              |
| `pnpm format`    | Prettier                                                                                       |

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests (with Postgres and Redis
service containers) and build, and checks that the Docker image builds.
