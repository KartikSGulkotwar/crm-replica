# CRM Replica

A customizable, metadata-driven CRM: keep companies, people and deals, and change the data model
itself (custom objects, fields, saved views, workflows and an AI agent).

> Inspired by [Twenty](https://github.com/twentyhq/twenty) (twentyhq/twenty). Independent
> implementation; no Twenty code used.

**Status:** Phase 8 of 12 (SDK + CLI). Phases 1–8 are the MVP. See [TWENTY_SPEC.md](TWENTY_SPEC.md) for the full plan.

## Done so far

- **Phase 1:** monorepo, API, worker, web app, Docker, CI, live health check.
- **Phase 2:** sign up (creates a workspace with its own Postgres schema, `workspace_<id>`, and
  makes you admin), log in / log out with an httpOnly JWT cookie, admin and member roles, one
  invite link per workspace (admins can reset it), Settings → General and Members, rate-limited
  auth endpoints.
- **Phase 3:** objects and fields are data (`core.object_metadata`, `core.field_metadata`), and
  schema-sync turns them into real Postgres tables and columns in each workspace's schema. New
  workspaces get Company, Person, Opportunity, Note and Task. Metadata API at `/api/metadata`
  (objects, fields, soft delete → restore → permanent delete, `/api/metadata/export`). All 13
  field types; relations get a foreign key and show up in reverse on the target object.
- **Phase 4:** records API for every object at `/api/objects/{plural}` (list, get, create, update,
  soft delete, restore). JSON filter trees (`and` / `or` / `not`, operators per field type),
  multi-field sort, cursor pagination, `?expand=` for relations in both directions,
  `record.created/updated/deleted/restored` events, and `/api/docs` generated live from your
  workspace's data model.
- **Phase 5:** the CRM screens. The sidebar lists your objects; each object has a spreadsheet-style
  table with in-place editing for every field type (select chips, stars, currency, dates,
  linked-record picker), resizable and reorderable columns, infinite scroll, row selection
  with bulk delete, and a "New record" dialog. Record pages show every field plus linked
  records from both directions.
- **Phase 6:** saved views (`core.view`, `view_field`, `view_filter`, `view_sort`; API at
  `/api/views`). Each object has a default view; you can add more. Filter builder (match all/any,
  operators per field type), sort builder, show/hide and reorder fields, column widths and
  order saved to the view, and a kanban board grouped by a select field with drag and drop
  between and within columns.
- **Phase 7:** Settings → Data model. Create custom objects (names, API names, icon) and add,
  edit or delete fields of all 13 types from the browser: select options with colors, rating
  size, default currency, relations (target object, reverse name, on-delete behaviour),
  required, default values. Deleted objects and fields can be restored or removed for good.
  Changes show up immediately in the sidebar, tables and kanban.
- **Phase 8:** objects as code. `@crm-replica/sdk` (`defineObject`, `defineField`, `defineView`),
  the `crm` CLI (`init`, `validate`, `diff`, `push`, `pull`), workspace API keys (Settings → API
  keys, `Authorization: Bearer crm_…`), `POST /api/metadata/apply` (plan + apply in one
  transaction), and `examples/sales-app`.

## What's in the repo

| Path                 | What it is                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| `apps/server`        | NestJS API (`/api`), OpenAPI docs at `/api/docs`, serves the web app in prod |
| `apps/worker`        | BullMQ worker process; reuses the server's compiled modules                  |
| `apps/web`           | React 18 + Vite + Tailwind + TanStack Query                                  |
| `packages/shared`    | Types and constants shared by everything (`FieldType`, queue names, …)       |
| `packages/sdk`       | `defineObject` / `defineField` / `defineView` for objects as code            |
| `packages/cli`       | The `crm` command: `init`, `validate`, `diff`, `push`, `pull`                |
| `examples/sales-app` | A Deal object, a kanban view and a table view, defined as code               |

## Objects as code

Define objects, fields and views in TypeScript and sync them like a database migration.

```ts
// examples/sales-app/objects/deal.ts
import { defineObject, FieldType } from '@crm-replica/sdk';

export default defineObject({
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  fields: [
    { name: 'name', label: 'Name', type: FieldType.TEXT },
    { name: 'amount', label: 'Amount', type: FieldType.CURRENCY },
    {
      name: 'stage',
      label: 'Stage',
      type: FieldType.SELECT,
      options: ['Lead', 'Negotiation', 'Won', 'Lost'],
    },
    { name: 'closeDate', label: 'Close Date', type: FieldType.DATE_TIME },
  ],
});
```

```console
$ crm diff
App sales-app → workspace Northwind at http://localhost:3000

  + Create object deal (Deals) with 4 fields
      + name (TEXT)
      + amount (CURRENCY)
      + stage (SELECT)
      + closeDate (DATE_TIME)
  + Add field deal.company (Relation → company)
  + Create table view "Big deals" on deal
  + Create kanban view "Deal pipeline" on deal

4 to create, 0 to update, 0 to remove

$ crm push --yes
✓ Applied 4 change(s) to the workspace.
```

- `crm diff` previews the plan. `crm push` applies it in **one transaction** (all or nothing).
- Changes that delete data (removing a field or object, changing a field's type) are refused
  unless you pass `--allow-destructive`.
- A push only removes what that app created. Fields and objects made in the UI are never
  deleted by code, and matching UI-made objects are adopted.
- `crm pull` writes the workspace's custom objects and views back to code.
- Authenticate with an API key from **Settings → API keys** (`CRM_API_KEY` or the app's `.env`).

See [examples/sales-app](examples/sales-app) to try it.

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
