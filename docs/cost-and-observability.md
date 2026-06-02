# Cost governance & observability

## Tag schema

Every AWS resource carries six keys, applied uniformly via Terraform `default_tags` on
every `aws` provider. Every Kubernetes object carries the same six keys as labels via
the Helm `_helpers.tpl`. See [ADR 0003](../fleet-managers/docs/adr/0003-tag-policy.md).

| AWS tag | K8s label | Values used in this account |
| --- | --- | --- |
| `tenant` | `ssp.platform/tenant` | `platform-shared` · `ssp-portal` · `<tenant-uuid>` |
| `product` | `ssp.platform/product` | `ssp-platform` · `ssp-portal` · `ssp-tenant-workload` |
| `environment` | `ssp.platform/environment` | `shared-prod` |
| `cost_center` | `ssp.platform/cost-center` | `platform-eng` · `<dept>-eng` |
| `managed_by` | `app.kubernetes.io/managed-by` | `terraform` |
| `owner` | (n/a) | `devops` · `platform-team` · `tenant-<domain>` |
| `domain` | `ssp.platform/domain` | tenant slug (per-tenant resources only) |
| `department` | `ssp.platform/department` | inherited from `Tenant.department` |

### Three tenant identities

- **`tenant=platform-shared`** — shared infra: VPC, NAT, EKS control plane, ALB
  Controller, External-DNS, cert-manager, ArgoCD, KMS CMK, WAF, Gateway namespace.
  Cost answers: *how much does running the platform cost regardless of tenancy?*
- **`tenant=ssp-portal`** — resources dedicated to the portal app itself: Cognito user
  pool, RDS Postgres `ssp-portal`, the `ssp-portal` namespace + workloads, the ECR
  repo for the portal image. Cost answers: *how much does the SSP product cost the
  platform team to run?*
- **`tenant=<uuid>`** — per-tenant workloads. Cost answers: *how much do we spend on
  growth-eng services this month?*

### Activating cost allocation

After the first apply, in AWS Billing → Cost Allocation Tags, enable the six keys
above. They appear as Cost Explorer dimensions within ~24h.

A Cost Explorer query like *Group by `tenant` over the last 30 days* immediately
splits the bill into the three buckets above. *Group by `product`* lets the platform
PM see how much of the platform's spend goes to the portal app vs the shared infra.

### OpenCost / Split Cost Allocation Data

EKS itself doesn't have an `AWS tag` for compute — it has Kubernetes labels. Two
mechanisms attribute compute:

1. **AWS Split Cost Allocation Data** (regional setting) — uses pod CPU/memory
   requests to apportion the shared EKS bill across namespaces. Reads the K8s labels
   we already set.
2. **OpenCost** (cluster-installed, MVP2) — reads the same K8s labels, joins with the
   EC2/EKS spend, and emits Prometheus metrics like
   `opencost_namespace_cost{namespace="tenant-acme", tenant="...", product="..."}`.

The labels we set on every namespace and pod (`ssp.platform/tenant`,
`ssp.platform/product`, `ssp.platform/cost-center`, `ssp.platform/department`,
`ssp.platform/environment`) feed both. Activating Split Cost Allocation Data is a
single console toggle; OpenCost adds a Grafana dashboard with the same dimensions.

### Why `domain` is immutable

The Postgres `BEFORE UPDATE` trigger `tenants_domain_immutable` rejects any update to
`tenants.domain`. The reason is cost-history continuity: if a tenant rename was allowed,
last month's `tenant=acme` would not aggregate with this month's `tenant=acme-renamed`
in Cost Explorer. The trigger is the cheapest possible enforcement — a single Postgres
function, applied to every transaction.

## Cost ceiling

Per-layer idle cost in eu-west-1, dev sizing:

```
EKS control plane              $73/mo
1 NAT Gateway                  $32/mo   (single-NAT dev mode)
2 t3.medium nodes              $60/mo
RDS db.t4g.micro               $15/mo
3 ALBs (2 Gateway, 1 Ingress)  $48/mo
ECR repo + storage             <$1/mo
WAFv2 WebACL + rules           ~$10/mo
Route53 zone + queries         <$1/mo
KMS CMK                        $1/mo
S3 state bucket                <$0.50/mo
CloudWatch logs (14d retain)   ~$3/mo
Cognito MAU                    free tier
Bedrock                        pay-per-token (Opus 4.6: ~$0.02 / CR)

Total idle                     ~$245/mo
```

Bedrock spend per ChangeRequest: typical approval is ~600 input + ~1200 output tokens
on Opus 4.6 = ~$0.02. A rejection is ~600 input + ~60 output = ~$0.005. Prompt caching
on the system prompt is the next major cost lever after the first hit per 5-min window.

## Observability

### Cluster

EKS-native:
- **CloudWatch Container Insights** is enabled by the EKS module — pod CPU/memory,
  node disk/io, control-plane logs.
- **Metrics Server** is installed in `kube-system` so `kubectl top` and HPA work.

Coming in MVP2:
- Prometheus + Grafana stack via kube-prometheus-stack chart, ingested into the
  platform Grafana.
- AlertManager rules for: tenant ResourceQuota breaching 80 %, NetPol denies,
  ArgoCD Application out-of-sync > 5 min, ALB 5xx rate > 1 %.

### Portal application

Today the portal logs to stdout, captured by `kubectl logs`. Each AI call emits a
single-line metric:

```
bedrock ok model=eu.anthropic.claude-opus-4-6-v1 ms=15078 tok_in=1136 tok_out=1227 cache_read=0
```

The five fields (model, latency, in/out tokens, cache-read tokens) are the entire
observability surface for the LLM step — enough to spot a regression in token usage
or a model swap that doubles latency. MVP2 ships them through the OpenTelemetry SDK
to ADOT and into CloudWatch / Tempo.

### WAF

Sampled and blocked requests go to CloudWatch log group `aws-waf-logs-ssp-shared-public-alb`
(14-day retention). `Authorization` and `Cookie` headers are redacted before storage —
the WAF logging configuration uses `redacted_fields` so a JWT or session cookie never
hits CloudWatch.

A Cost Explorer / Athena query against this log group gives:
- Top blocked source IPs (rate-limit triggers)
- Top blocked rule names (which OWASP category fires most)
- Per-host volume (which tenant is getting the most traffic)

### ArgoCD

ArgoCD's UI is the live mirror of the GitOps repo. Per-Application sync history is
visible in the UI; the same data is available via API:

```bash
kubectl -n argocd get applications -o yaml
```

The `app-of-apps` pattern means ArgoCD has full transitive history — every
ChangeRequest that's been merged becomes one or more sync events visible in one place.

### Postgres `service_revisions`

The single source of truth for *what state did this service go through and why?* —
append-only, queryable by tenant, status, time range. A platform engineer answering
"why is acme/hello at version X?" runs one SQL query:

```sql
SELECT
  sr.created_at, sr.service_status, sr.cr_status, sr.cd_manifest_ref, sr.ai_summary
FROM service_revisions sr
JOIN services s ON s.id = sr.service_id
JOIN tenants  t ON t.id = s.tenant_id
WHERE t.domain = 'acme' AND s.name = 'hello'
ORDER BY sr.created_at DESC
LIMIT 20;
```

This is also what the portal renders as the accordion timeline on the service detail
page.

## SLOs (proposed, not yet enforced)

| Indicator | Target | Burn rate alert |
| --- | --- | --- |
| Portal `/login` HTTP 200 | 99.5 % over 30d | 2× error budget over 6h |
| CR → PR opened latency (approved path) | p95 < 30s | p95 > 60s for 1h |
| AI rejection accuracy (no false approvals on hard caps) | 100 % weekly | any false approval is a P1 incident |
| ArgoCD sync to healthy | p95 < 5min | p95 > 10min for 30min |
| Tenant ALB 5xx rate | < 1 % | > 5 % for 5min |

The accuracy SLO is the interesting one — it asks the team to investigate every
approved CR that *should have been rejected*, treating it as a prompt regression. The
e2e sweep in [e2e-evidence.md](./e2e-evidence.md) is the seed of that test suite.
