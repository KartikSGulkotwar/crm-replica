# Deploying to Railway

The app needs four things running: the **web** service (NestJS API, which also serves the React
app), the **worker** (BullMQ jobs: workflow runs), **Postgres** and **Redis**. Serverless hosts
like Vercel don't fit, so this guide uses [Railway](https://railway.com). Both app services are
built from the same `Dockerfile` and differ only in their start command (see `railway/web.json`
and `railway/worker.json`).

Expect about 20 minutes. Railway's paid Hobby plan (or its free trial) is enough for a demo.

## 1. Put the code on GitHub

Railway deploys from a GitHub repository.

1. On github.com click **New repository**, name it (e.g. `crm-replica`), choose public or private,
   and **don't** add a README or .gitignore (the repo already has them).
2. In the project folder:

   ```bash
   git remote add origin https://github.com/<you>/crm-replica.git
   git push -u origin main
   ```

## 2. Create the project, Postgres and Redis

1. Go to [railway.com](https://railway.com), log in with GitHub, click **New Project → Deploy
   from GitHub repo**, and pick your repository. Railway creates a service and starts a first
   build. It will fail or stay unhealthy until the next steps are done; that's expected.
2. Click the new service, then **Settings**:
   - **Service name:** `web`
   - **Config-as-code → Railway config file:** `/railway/web.json`
3. Back on the project canvas, click **+ Create → Database → PostgreSQL**. Do it again for
   **Redis**. You now have `Postgres` and `Redis` next to `web`.

## 3. Variables

Open **Project Settings → Shared Variables** and add these (they're shared by both services):

| Variable            | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`          | `production`                                                                |
| `DATABASE_URL`      | `${{Postgres.DATABASE_URL}}`                                                |
| `REDIS_URL`         | `${{Redis.REDIS_URL}}`                                                      |
| `JWT_SECRET`        | A long random string. Generate one with `openssl rand -base64 48`.          |
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com (enables Ask the CRM and the AI step)   |
| `DEMO_MODE`         | `true` for a public demo (see below), otherwise leave it out                |
| `AGENT_DAILY_LIMIT` | e.g. `200`: assistant questions per user per day (protects your API budget) |
| `RESEND_API_KEY`    | Optional: send workflow emails for real (otherwise they're only logged)     |
| `EMAIL_FROM`        | Optional, with Resend: e.g. `CRM <crm@yourdomain.com>`                      |

Then share them with the web service: open **web → Variables → Shared Variables** and add them
all. Also add one variable that's only for **web**:

| Variable  | Value                                |
| --------- | ------------------------------------ |
| `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |

## 4. Give the web service a URL

**web → Settings → Networking → Generate Domain.** If it asks for a port, enter `3000` (the
app listens on Railway's `PORT`, which it sets for you). You get an address like
`crm-replica-production.up.railway.app`.

Click **Deploy** (or wait for the automatic redeploy). The first start runs the database
migrations and, with `DEMO_MODE=true`, builds the demo workspace; the health check at
`/api/health` waits for that.

## 5. Add the worker

1. On the canvas click **+ Create → GitHub Repo** and pick the same repository again.
2. **Settings:** service name `worker`; **Railway config file:** `/railway/worker.json`. Leave
   networking alone: the worker doesn't need a URL.
3. **Variables → Shared Variables:** add them all, plus:

   | Variable  | Value                                    |
   | --------- | ---------------------------------------- |
   | `APP_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |

4. Deploy.

## 6. Check it

1. Open `https://<your-domain>/api/health`. You should see `"status":"ok"` with `database`,
   `redis` **and** `worker` all `"up"`. (`"degraded"` with `worker: "down"` means the worker
   isn't running yet: check its logs.)
2. Open `https://<your-domain>`. With `DEMO_MODE=true`, the login page shows **Try the demo**
   with the demo login; click **Log in to the demo**.
3. Open **Opportunities → Pipeline**, drag a deal to **Won**, then open **Workflows → Deal won:
   kickoff → Runs**: the run should be **Succeeded** within a few seconds, and the deal's page
   shows the new task.
4. Press **⌘K** (Ctrl+K) and **⌘J** (Ctrl+J) to try search and the assistant.
5. On your phone, open the same address.

## The public demo

With `DEMO_MODE=true` the server keeps a workspace called **Acme Demo** with 30 companies,
60 people, 40 opportunities, notes, tasks, a kanban "Pipeline" view and the "Deal won" workflow.

- The login is shown on the login page. Defaults: `demo@example.com` / `try-the-demo`. Change
  them with `DEMO_EMAIL` and `DEMO_PASSWORD`.
- Every night at 03:00 UTC it's deleted and rebuilt from scratch (`DEMO_RESET_CRON`, a cron
  expression in UTC), so visitors can change anything. Anyone logged in at that moment is
  signed out.
- Everyone shares the demo login, so `AGENT_DAILY_LIMIT` is effectively a daily cap for the
  whole demo; `AGENT_RATE_LIMIT` (default 20 per minute) still applies too.
- Visitors can also create their own workspaces with **Create a workspace**; those are kept.

## Updating

Push to `main`. Railway rebuilds both services from the same commit; migrations run when the
web service starts.

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Web logs: `Invalid environment variables` / `JWT_SECRET` | In production `JWT_SECRET` must be set, at least 32 characters, and not the example value.                                               |
| Web logs: `ECONNREFUSED` / `ENOTFOUND` for Redis         | `REDIS_URL` must be `${{Redis.REDIS_URL}}` (the private address). The app looks up IPv6 addresses, which Railway's private network uses. |
| Health check times out on first deploy                   | Open the web logs: the first start runs migrations and (with `DEMO_MODE`) builds the demo, which takes a few seconds.                    |
| Logged out right after logging in                        | `APP_URL` must start with `https://` and match the domain you use, so the session cookie is marked secure correctly.                     |
| Workflows never run                                      | The worker isn't up, or it has different `DATABASE_URL` / `REDIS_URL`. `/api/health` shows `worker`.                                     |
| Ask the CRM says it isn't set up                         | Add `ANTHROPIC_API_KEY` to the shared variables and redeploy **web** and **worker**.                                                     |
