# sales-app (objects-as-code example)

A custom **Deal** object, a **Deal pipeline** kanban view and a **Big deals** table view, defined in
TypeScript with `@crm-replica/sdk` and synced to a workspace with the `crm` CLI.

```
objects/deal.ts          defineObject: fields, select options, relation to Company
views/deal-pipeline.ts   defineView: kanban grouped by stage
views/big-deals.ts       defineView: amount ≥ 50,000, sorted by close date
crm.json                 app name ("sales-app") and server URL
```

## Try it

1. In the CRM: **Settings → API keys → New key**. Copy the key.
2. `cp .env.example .env` and paste the key after `CRM_API_KEY=`.
3. From this folder:

```bash
pnpm crm validate   # checks the definitions locally
pnpm crm diff       # shows the plan: what would be created / changed / removed
pnpm crm push       # applies it (asks first)
```

Pushing again changes nothing. Edit a file (e.g. add a stage) and `crm diff` shows exactly that.
Removing a field or object is **destructive** and needs `crm push --allow-destructive`.

The app only removes things it created. Fields people add in the UI are never deleted by a push.
