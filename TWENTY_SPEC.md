# TWENTY_SPEC.md — Twenty CRM Replica

> Put this file in the root of a new, empty repo named `twenty-crm-replica` and tell Claude Code:
> "Read TWENTY_SPEC.md and build it phase by phase. After each phase: run the tests, explain in plain language what was built, give me click-by-click steps to check it myself with what I should see, commit, and wait for my go-ahead."

---

## 0. What we're building

A **customizable CRM**: a place where a sales team keeps its companies, people and deals, and where the data model itself can be changed. Users can add new record types ("objects"), add fields, save views (table / kanban, with filters and sorting), automate work with workflows, and ask an AI agent to work with the data.

This is an **independent implementation inspired by Twenty** (the open-source Salesforce alternative). It is built around Twenty's four building blocks:

1. **Objects**: record types with fields (Companies, People, Opportunities, plus custom ones)
2. **Views**: saved ways to look at an object (table or kanban, with filters, sorts and visible columns)
3. **Workflows**: "when X happens, do Y" automation, run in the background with BullMQ
4. **Agents**: an AI assistant that can search, create and update CRM records using tool calling

It also includes its own **SDK + CLI** so objects, fields and views can be **defined as code** and pushed to the app. This mirrors Twenty's `defineObject` + `twenty app:publish` approach.

### Licensing rule (important)
Twenty is licensed under **AGPL-3.0**. **Do not copy code, styles, icons, or assets from the Twenty repo.** Read its docs and code only to understand concepts and architecture, then write everything ourselves. Credit Twenty as inspiration in the README.

---

## 1. Reference links (read these to understand concepts; don't copy code)

Use WebFetch on these when you need to understand how Twenty approaches something:

- Main repo: https://github.com/twentyhq/twenty
- README (concepts, SDK example): https://github.com/twentyhq/twenty/blob/main/README.md
- Packages folder (monorepo layout): https://github.com/twentyhq/twenty/tree/main/packages
  - Backend: https://github.com/twentyhq/twenty/tree/main/packages/twenty-server
  - Frontend: https://github.com/twentyhq/twenty/tree/main/packages/twenty-front
  - SDK: https://github.com/twentyhq/twenty/tree/main/packages/twenty-sdk
- Their CLAUDE.md (coding conventions they use): https://github.com/twentyhq/twenty/blob/main/CLAUDE.md
- Documentation home: https://docs.twenty.com
- Apps / defining objects as code: https://docs.twenty.com/developers/extend/apps/getting-started
- App building primitives: https://docs.twenty.com/developers/extend/apps/building
- Publishing / version control of apps: https://docs.twenty.com/developers/extend/apps/publishing
- User guide (how the product behaves): https://docs.twenty.com/user-guide/introduction
- Layouts: https://docs.twenty.com/user-guide/layout/overview
- AI features: https://docs.twenty.com/user-guide/ai/overview
- Self-hosting with Docker Compose: https://docs.twenty.com/developers/self-host/capabilities/docker-compose

Helpful repo explorers (for the human; optional for Claude Code):
- https://gitdiagram.com/twentyhq/twenty (architecture diagram)
- https://gitingest.com/twentyhq/twenty (repo as text; very large, so only use specific subfolders)

---

## 2. Tech stack

**Monorepo**: pnpm workspaces (Nx optional; keep it simple)

**Backend (`apps/server`)**
- NestJS + TypeScript
- PostgreSQL with TypeORM for *metadata* tables, plus a query builder (TypeORM QueryBuilder or Kysely) for *dynamic* record tables
- Redis + **BullMQ** for workflow jobs (separate worker process)
- REST API (auto-generated per object) + OpenAPI docs via `@nestjs/swagger`
- Auth: JWT in an httpOnly cookie, bcrypt password hashing
- Anthropic Claude API for the agent (tool calling)
- class-validator / zod for input validation
- Jest for tests

**Frontend (`apps/web`)**
- React 18 + TypeScript + Vite
- TanStack Query (server state), TanStack Table (table view)
- dnd-kit (kanban drag and drop)
- Tailwind CSS
- React Router

**SDK + CLI (`packages/sdk`, `packages/cli`)**
- `@crm-replica/sdk`: `defineObject`, `defineField`, `defineView`, `defineWorkflow`, `FieldType` enum, all fully typed
- `crm` CLI (commander): `crm init`, `crm validate`, `crm diff`, `crm push`, `crm pull`
- Use our own package names; don't use the `twenty-sdk` name.

**Infra**
- Docker + docker-compose (server, worker, web, postgres, redis)
- GitHub Actions CI (lint, typecheck, test, with Postgres and Redis service containers)

---

## 3. Repo structure

```
twenty-crm-replica/
├── apps/
│   ├── server/                 # NestJS API
│   │   └── src/
│   │       ├── auth/
│   │       ├── workspace/
│   │       ├── metadata/       # objects, fields, views (the "schema about the schema")
│   │       ├── records/        # dynamic CRUD for any object
│   │       ├── schema-sync/    # turns metadata into real Postgres tables/columns
│   │       ├── workflows/      # definitions, triggers, runs
│   │       ├── agents/         # Claude tool-calling agent
│   │       └── events/         # record.created / updated / deleted event bus
│   ├── worker/                 # BullMQ worker (shares code with server)
│   └── web/                    # React app
├── packages/
│   ├── sdk/                    # defineObject etc.
│   ├── cli/                    # crm push / pull / diff
│   └── shared/                 # shared types (FieldType, DTOs)
├── examples/
│   └── sales-app/              # objects/views/workflows defined as code via the SDK
├── docker-compose.yml
├── .github/workflows/ci.yml
└── README.md
```

---

## 4. Core design

### 4.1 Metadata-driven data model (the heart of the project)
Twenty's key idea is that **objects and fields are data, not hard-coded classes.** We do the same:

- **Metadata tables** (TypeORM entities): `workspace`, `user`, `object_metadata`, `field_metadata`, `view`, `view_field`, `view_filter`, `view_sort`, `workflow`, `workflow_version`, `workflow_run`, `agent_conversation`, `api_key`.
- **Record tables are real Postgres tables**, created and altered at runtime by `schema-sync`:
  - creating an object → `CREATE TABLE` in the workspace schema
  - adding a field → `ALTER TABLE ADD COLUMN`
  - deleting → soft-delete the metadata, then drop it after confirmation
  - every record table gets `id (uuid)`, `created_at`, `updated_at`, `deleted_at`, `created_by`, `position`
- Each workspace gets its **own Postgres schema** (`workspace_<id>`), which gives multi-tenant isolation.
- All dynamic SQL goes through a single, carefully parameterized builder. **Identifiers are validated against metadata (whitelist), never interpolated from user input.**

### 4.2 Field types (MVP)
`TEXT`, `NUMBER`, `CURRENCY` (amount + currency code), `BOOLEAN`, `DATE`, `DATE_TIME`, `SELECT`, `MULTI_SELECT`, `EMAIL`, `PHONE`, `LINK`, `RATING`, `RELATION` (many-to-one, with the reverse one-to-many shown in the UI).

Each type defines: how it maps to Postgres columns, validation, filter operators (e.g. `contains`, `eq`, `gt`, `in`, `isEmpty`), and its UI cell / editor.

### 4.3 Standard objects (seeded per workspace)
- **Company**: name, domain (LINK), employees (NUMBER), industry (SELECT), annual revenue (CURRENCY)
- **Person**: first/last name, email, phone, job title, company (RELATION → Company)
- **Opportunity**: name, amount (CURRENCY), stage (SELECT: New, Qualified, Proposal, Won, Lost), close date, company (RELATION), point of contact (RELATION → Person)
- **Note** and **Task** (task has due date, status, assignee) linked to any record

Standard objects can get extra custom fields but can't be deleted.

### 4.4 Records API (auto-generated)
For every object `{plural}`:
| Method | Path |
|---|---|
| GET | /api/objects/{plural}?filter=…&sort=…&limit=…&cursor=… |
| GET | /api/objects/{plural}/{id} |
| POST | /api/objects/{plural} |
| PATCH | /api/objects/{plural}/{id} |
| DELETE | /api/objects/{plural}/{id} (soft delete) |

- Cursor pagination, typed filters (JSON filter tree with `and` / `or`), multi-field sort.
- Relations can be expanded with `?expand=company`.
- The OpenAPI spec is **regenerated whenever metadata changes**, so `/api/docs` always shows current objects.
- Every create / update / delete emits an event (`record.created` etc.) that workflows listen to.

### 4.5 Metadata API
CRUD for objects, fields, views, view fields / filters / sorts. Also `GET /api/metadata/export` (whole schema as JSON) and `POST /api/metadata/apply` (used by the CLI; applies a diff in one transaction and reports exactly what changed).

### 4.6 Views
- Each object has one default view plus any number of saved views.
- A view stores type (TABLE or KANBAN), visible fields and their order and widths, filters, sorts, and (for kanban) the SELECT field to group by.
- Kanban drag and drop updates the group-by field and `position`.

### 4.7 Workflows
- **Triggers**: record created, record updated (optionally only when certain fields change), record deleted, manual (a button on a record), schedule (cron).
- **Actions**: create record, update record, find records, send email (log in dev; optional Resend in prod), HTTP request (webhook), delay, **AI step** (Claude summarizes or classifies a record and writes the result to a field), and a simple if/else branch.
- Steps can reference earlier data with variables like `{{trigger.record.name}}` and `{{steps.find_company.result.id}}`.
- Execution: the event bus puts a job on a **BullMQ** queue. The **worker** runs the steps, with retries and exponential backoff for failed steps, and stores a `workflow_run` with per-step status, input, output and errors.
- Versioning: editing a workflow creates a new draft version. Publishing makes it active, and older runs keep pointing at the version they ran.
- Guard against infinite loops (a workflow updating the record that triggered it): a max-depth counter on the event.

### 4.8 Agents (AI)
- A chat panel available on every page: "Ask the CRM".
- Uses the **Claude API with tool calling**. Tools are generated from metadata:
  - `search_records(object, filter)`, `get_record(object, id)`, `create_record(object, data)`, `update_record(object, id, data)`, `list_objects()`, `describe_object(object)`
- Tools respect the current user's permissions.
- **Any write needs the user's confirmation in the UI** before it runs (show the proposed change, with Approve / Reject).
- Answers link to the records they used.
- Example prompts for the demo: "Which opportunities over $50k close this month?", "Create a follow-up task for every deal in Proposal stage", "Summarize everything we know about Acme".

### 4.9 SDK + CLI (objects, fields and views as code)
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
    { name: 'stage', label: 'Stage', type: FieldType.SELECT,
      options: ['Lead', 'Negotiation', 'Won', 'Lost'] },
    { name: 'closeDate', label: 'Close Date', type: FieldType.DATE_TIME },
  ],
});
```
- `crm init` scaffolds an app folder.
- `crm validate` type-checks and validates definitions (zod).
- `crm diff` shows what would change in the workspace (added / changed / removed objects, fields and views). It's like a migration plan.
- `crm push` applies the diff through `/api/metadata/apply`. It refuses destructive changes unless `--allow-destructive` is passed.
- `crm pull` exports the current workspace schema back to code files.
- Authenticate with a workspace API key (created in Settings).
- `examples/sales-app` defines a custom **Deal** object, a kanban view and a workflow, all as code. It's used in the README demo.

### 4.10 Auth and workspaces
- Sign up creates a workspace, and the first user is its admin.
- Invite members by link. Roles are **admin** (can change the data model, workflows and API keys) and **member** (can work with records).
- API keys are per workspace, stored hashed, and used by the CLI and the REST API.
- Rate limit the auth and agent endpoints.

---

## 5. Frontend

- **Layout**: left sidebar listing all objects (standard + custom), Workflows, Settings. Command palette (Cmd+K) to jump to records and objects.
- **Object page**: view switcher (saved views dropdown), Table / Kanban toggle, filter builder, sort builder, field visibility menu, "+ New record".
- **Table view**: inline cell editing per field type, column resize and reorder, infinite scroll, row selection with bulk delete.
- **Kanban view**: columns from a SELECT field, drag cards between columns, card shows chosen fields.
- **Record page**: all fields (editable), related records (e.g. a company's people and opportunities), notes, tasks, and a timeline of changes.
- **Settings → Data model**: list objects, create custom object, add / edit / delete fields with the right options per type (e.g. select options with colors).
- **Workflows**: list, and a step-based editor (a vertical list of steps is fine; a canvas isn't required), with a variable picker, a "Test run" button, and a run history with per-step input / output / errors.
- **AI agent panel**: slide-over chat, streaming answers, record links, approve / reject cards for proposed writes.
- **Settings → API keys & members.**
- Empty, loading and error states everywhere. Works at phone width.
- Clean, original design (don't imitate Twenty's look). Light and dark mode.

---

## 6. Phases (build, test, explain, commit, then wait)

1. **Scaffold**: pnpm monorepo, NestJS server, React app, worker, shared package; docker-compose with Postgres and Redis; health endpoint; CI.
2. **Auth & workspaces**: signup / login, JWT cookie, workspace schema created on signup, roles, invite link.
3. **Metadata + schema sync**: object and field metadata, dynamic table / column creation, standard objects seeded. Tests for schema-sync (create object, add field, each field type).
4. **Records API**: generic CRUD, filters, sorts, cursor pagination, relations / expand, events emitted, live OpenAPI docs. Tests for the filter builder (including SQL-injection attempts).
5. **Table UI**: sidebar, object page, table view with inline editing per field type, record page.
6. **Views**: saved views, filter / sort builders, field visibility, kanban with drag and drop.
7. **Data model settings UI**: create custom objects and fields from the browser and see them appear immediately.
8. **SDK + CLI**: defineObject / defineView, validate, diff, push, pull, API keys; `examples/sales-app` working end to end.
9. **Workflows**: BullMQ queue + worker, triggers, actions, variables, versions, run history, workflow editor UI.
10. **AI agent**: Claude tool calling over CRM data, confirmation for writes, AI workflow step.
11. **Polish**: notes and tasks, timeline, command palette, seed demo data (about 30 companies, 60 people, 40 opportunities), mobile layout, rate limits.
12. **Deploy + README** (section 7).

**MVP cutoff if time is short: Phases 1–8.** That already shows objects, views, and objects-as-code. Phases 9–10 add workflows and agents.

---

## 7. Deployment

This app needs **a web server, a background worker, Postgres and Redis**, so serverless platforms like Vercel don't fit. Use **Railway** (or Render):

- One Docker image with two start commands:
  - `web` service: NestJS API, which also serves the built React app from `/` (single URL, no CORS)
  - `worker` service: BullMQ worker
- Railway Postgres and Railway Redis add-ons
- Env vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `APP_URL`, optional `RESEND_API_KEY`
- Public demo: a pre-seeded **demo workspace** with a demo login shown on the login page; a nightly job resets it; the agent is rate-limited per user.
- Provide `.env.example` and `docs/deploy-railway.md` with click-by-click steps.

Local development on a Mac: `docker compose up` for Postgres and Redis, and run server, worker and web with `pnpm dev`.

---

## 8. README must include

- One-line pitch, **live demo link + demo login**, screenshot / GIF of: creating a custom object, the kanban view, a workflow run, and the agent answering a question
- Mermaid architecture diagram: React → NestJS (metadata, records, schema-sync, agents) → Postgres (per-workspace schemas) and Redis / BullMQ → worker
- **Objects as code** section showing the `defineObject` example and `crm diff` / `crm push` output
- "Design decisions": metadata-driven schema with real tables, per-workspace Postgres schemas, safe dynamic SQL, event-driven workflows with BullMQ, tool-calling agent with human approval for writes
- Local setup, tests, deployment
- Credit: "Inspired by Twenty (twentyhq/twenty). Independent implementation; no Twenty code used."

---

## 9. Definition of done

- [ ] `docker compose up` + `pnpm dev` works from a clean clone
- [ ] Create a custom object and fields in the UI, and they work immediately in table and kanban
- [ ] Same thing works via `crm push` from `examples/sales-app`, with `crm diff` showing the plan
- [ ] Saved views with filters and sorts persist
- [ ] A workflow ("when an opportunity moves to Won, create a task and send an email") runs in the worker, and its run history shows each step
- [ ] The agent answers questions about records and asks before changing anything
- [ ] Tests pass in CI (schema-sync, filter builder, workflow runner, agent tools)
- [ ] Live demo works on desktop and mobile
- [ ] README complete
