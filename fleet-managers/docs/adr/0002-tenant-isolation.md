# ADR 0002 — Tenant isolation: namespace + IRSA

Status: accepted (MVP1)
Date: 2026-06-01

## Context

Tenants are internal departments, not external customers. They must not be able to interfere with each other's pods or assume each other's AWS roles, but we don't need hard kernel isolation (vCluster, Kata, etc.) for MVP1.

## Decision

For MVP1, a tenant = a Kubernetes namespace plus an IRSA-bound role.

- **Namespace** per tenant. `ResourceQuota` + `LimitRange` cap CPU/memory.
- **NetworkPolicy** denies cross-namespace ingress by default. Explicit allows for shared infrastructure (e.g. ingress controller).
- **IRSA / Pod Identity** binds the namespace's default ServiceAccount to a tenant-scoped IAM role. Role policies are scoped to Bedrock model invocations and a tenant-prefixed S3 path.
- **Tags** propagate from `Tenant.tags` to both AWS resources (via `default_tags` in the IAM module) and Kubernetes objects (via Helm labels) for cost attribution.

## Consequences

- Soft multi-tenancy: a privileged tenant pod could in theory read other namespaces' API server data if RBAC is misconfigured. We mitigate via `AppProject`-scoped ArgoCD RBAC and explicit `Role`/`RoleBinding` in the namespace module.
- Moves to hard isolation (vCluster, separate node groups) are non-breaking from the data-model perspective — `tenant.id` is stable.
- IRSA OIDC trust is set up once at the cluster level (DevOps-owned). Per-tenant role creation is automated by `tenant-iam` module.
