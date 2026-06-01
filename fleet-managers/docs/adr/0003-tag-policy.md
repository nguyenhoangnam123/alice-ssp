# ADR 0003 — Tag & label policy for cost attribution

Status: accepted (MVP1)
Date: 2026-06-01

## Context

Shared EKS cluster + shared VPC + shared ALB means tenant cost is invisible by
default in Cost Explorer. We need consistent tag/label keys across AWS resources and
Kubernetes objects so OpenCost (cluster split) and Cost Explorer (AWS split) can roll
up by tenant, product, and cost center without per-service reconciliation.

The user explicitly called out the SSP portal app (`llm-product-poc`) as a "tenant
product" — meaning the portal itself must be cost-trackable as a distinct line item,
not silently absorbed into shared infra.

## Decision

Standard tag/label keys, applied uniformly via `default_tags` on every `aws` provider
and via Helm `_helpers.tpl` labels on every Kubernetes object:

| Key (AWS) | Key (K8s label) | Value examples | Notes |
| --- | --- | --- | --- |
| `tenant` | `ssp.platform/tenant` | `platform-shared`, `ssp-portal`, `<tenant-uuid>` | The cost-attribution anchor |
| `product` | `ssp.platform/product` | `ssp-platform`, `ssp-portal`, `ssp-tenant-workload` | What product/service this resource belongs to |
| `environment` | `ssp.platform/environment` | `shared-prod`, `shared-dev` | |
| `cost_center` | `ssp.platform/cost-center` | `platform-eng`, `growth-eng`, `payments-eng` | Finance roll-up dimension |
| `managed_by` | `app.kubernetes.io/managed-by` | `terraform` | Always |
| `owner` | n/a | `devops`, `platform-team`, `tenant-<domain>` | Operational owner |
| `domain` | `ssp.platform/domain` | `acme`, `payments` | Only on per-tenant resources |
| `department` | `ssp.platform/department` | `growth`, `payments` | Inherited from `Tenant.department` |

### Tenant-anchor values

- `tenant=platform-shared` — shared infra everyone uses (VPC, NAT, EKS control plane,
  ALB Controller, External-DNS, cert-manager, ArgoCD).
- `tenant=ssp-portal` — resources dedicated to the SSP portal app itself (Cognito user
  pool, the portal's RDS instance, the portal's namespace + workloads).
- `tenant=<uuid>` — per-tenant workloads (set automatically by `tenant-iam` /
  `tenant-namespace` modules from the `Tenant.id` value).

### Layer-level overrides

Each foundation layer adds a `component` tag in its `locals.tags` so individual
resources can be filtered without polluting the canonical schema:

- `component=state-backend` (00-bootstrap)
- `component=network` (10-vpc)
- `component=eks-control-plane` (20-eks)
- `component=auth` (30-cognito)
- `component=platform-addons` (40-platform-addons)
- `component=gitops-argocd` (50-argocd)

### Activation

After the first apply, in AWS Billing console → Cost Allocation Tags, enable:
- `tenant`, `product`, `environment`, `cost_center`, `domain`, `department`, `managed_by`

These appear as cost allocation dimensions in Cost Explorer ~24h after activation.

For OpenCost / Split Cost Allocation Data inside the cluster, the K8s labels are
read automatically from each namespace and pod — no extra config beyond installing
OpenCost (deferred to MVP2).

## Consequences

- Every new resource MUST carry these tags. PR review enforces it; longer-term we add
  a `pre-commit` Terraform hook (or `checkov`) that fails on missing required tags.
- Renaming a tenant's `domain` would break cost history for that tenant — which is one
  more reason the domain is immutable in `Tenant.domain` (Postgres trigger in the
  portal DB, plus this is a `tenant`/`domain` AWS tag that becomes a cost-history key).
- The platform team's own cost — running the SSP portal — is attributed under
  `tenant=ssp-portal` / `product=ssp-portal`. This makes "how much does the platform
  cost us per month?" a single Cost Explorer query.
