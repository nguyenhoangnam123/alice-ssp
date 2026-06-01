# llm-product-poc

SSP portal — the **Platform-team-owned control plane**. Users submit Services and ChangeRequests here; the workflow opens PRs against `fleet-managers/` for a platform engineer to review.

For MVP1, all AWS integrations (Cognito, Bedrock, Step Functions) are **stubbed** behind interfaces so they can be swapped to real implementations without changing call sites.

## Stack

- **Next.js 15** App Router (full-stack TS), Server Actions for API
- **Drizzle ORM** + **Postgres**
- **Tailwind CSS**
- Auth: **Cognito** (stubbed)
- AI: **Bedrock Claude** (stubbed)
- Workflow: in-process state machine that mimics **Step Functions** transitions

## Layout

```
src/
  app/
    (auth)/login           sign-in (stub)
    (dashboard)/
      tenants              CRUD UI for Tenant
      services             CRUD UI for Service
      change-requests      CR list + detail with revisions timeline
    api/                   JSON endpoints (mirror the UI server actions)
  lib/
    db/                    drizzle schema + connection + migrations
    auth/                  session + RBAC (UserTenant scope)
    workflow/              orchestrator: aiReview → platformReview → provisioning → working
    ai/                    AI agent stub — generates Dockerfile / CI / Helm values
    github/                fleet-managers PR opener stub
    policy/                deterministic OPA-style gate (quota, domain free, etc.)
  components/              shared UI
drizzle/
  migrations/              generated SQL
```

## Local dev

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:push          # apply schema (use db:generate + db:migrate for committed migrations)
npm run db:seed          # optional: seed an admin user + sample tenant
npm run dev
```

Visit http://localhost:3000.

## Stubs vs real

| Concern              | MVP1 stub                                  | MVP2 (real)               |
| -------------------- | ------------------------------------------ | ------------------------- |
| Auth                 | `AUTH_MODE=stub` — session via cookie     | Cognito Hosted UI         |
| Workflow             | `WORKFLOW_MODE=in-process` state machine   | Step Functions Standard   |
| AI agent             | `AI_MODE=mock` — deterministic fake output | Bedrock InvokeModel       |
| Policy gate          | TS rules in `lib/policy/gate.ts`           | OPA / Conftest sidecar    |
| PR opener            | logs the PR body to stdout                 | Octokit against fleet-mgr |

Swap by changing `AUTH_MODE`, `WORKFLOW_MODE`, `AI_MODE` in `.env`.

## Data model

See `src/lib/db/schema.ts`. Mirrors the design diagram:
Tenant → UserTenant ← User
Tenant → Service → ChangeRequest → ServiceRevision (append-only)

Every query must filter by `tenant_id` derived from the user's `UserTenant` rows. See `src/lib/auth/rbac.ts` for the enforcement helper.
