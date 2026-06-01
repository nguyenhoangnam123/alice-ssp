# ADR 0002 — RBAC: tenant-scoped admin (MVP1)

Status: accepted (MVP1)
Date: 2026-06-01

## Context

All company employees share one Cognito user pool (DevOps-owned). The portal must
prevent users from acting on other tenants' data. Per the design spec, MVP1 supports a
single role (`admin`); a `UserTenantPermission` layer is foreseen for MVP2.

## Decision

- `UserTenant` is the membership table: `(user_id, tenant_id, role)` with `role = admin`
  for MVP1.
- Every server action and API route that touches tenant-scoped data calls
  `requireTenantAdmin(tenantId)` from `lib/auth/rbac.ts`.
- Cross-tenant list endpoints (e.g. `/api/services`) compute the accessible tenant set
  via `listAccessibleTenantIds()` and filter in-query — never client-side.
- The `domain` field is `UNIQUE` and made immutable via a Postgres trigger
  (`tenants_domain_immutable`), so RBAC scoping by tenant remains stable across renames.

## Consequences

- A bug that forgets to call `requireTenantAdmin` leaks data. Mitigate by code review
  and (MVP2) row-level security policies in Postgres keyed on a session GUC.
- Adding roles (reader/contributor) is additive: extend the `user_tenant_role` enum and
  the `requireTenantAdmin` helper into `requireTenantRole(tenantId, ['admin','reader'])`.
- No org-level "super-admin" yet. The seed admin is a tenant member, not a global role.
