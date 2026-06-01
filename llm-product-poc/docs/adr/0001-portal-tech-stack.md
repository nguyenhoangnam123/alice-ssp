# ADR 0001 — Portal tech stack

Status: accepted (MVP1)
Date: 2026-06-01

## Context

The portal needs to ship fast, integrate with AWS (Cognito, Bedrock, Step Functions, IRSA),
and be readable by both platform engineers and product engineers.

## Decision

- **Next.js 15 App Router (full-stack TypeScript).** Single runtime, server actions for
  mutations, RSC for reads. Reduces moving parts vs separate API+UI.
- **Drizzle ORM + Postgres.** Type-safe schema-first model. Postgres covers the relational
  needs (FKs across Tenant→Service→CR→Revision) and is the standard RDS choice.
- **Tailwind CSS.** No design-system overhead; keeps the surface area small.
- **Zod** for request validation at the API edge.
- **ULID** for IDs. Sortable, opaque, URL-safe.

Stubbed for MVP1 (real impls come in MVP2):
- Cognito → cookie-based stub session
- Bedrock → deterministic mock in `lib/ai/agent.ts`
- Step Functions → in-process state machine in `lib/workflow/orchestrator.ts`
- OPA / Conftest → TS rules in `lib/policy/gate.ts`
- GitHub Octokit PR → stdout log in `lib/github/pr.ts`

All stubs respect the same interface as the real implementations, so MVP2 swaps are
file-local.

## Consequences

- One deploy target (Next.js standalone build) → simpler to operate.
- Server actions are tied to Next.js — if we outgrow it, the API logic in `lib/` is
  portable but the route handlers/actions are not.
- Postgres ties us to RDS or compatible (Aurora). No serverless DynamoDB path.
