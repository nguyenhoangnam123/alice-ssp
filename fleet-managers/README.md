# fleet-managers

GitOps source of truth for the SSP platform. PRs merged here trigger ArgoCD reconciliation into per-tenant EKS namespaces.

## Ownership

- **DevOps** owns the cluster, ArgoCD install, ingress, Cognito pool, account guardrails.
- **Platform team** owns this repo: per-tenant Terraform modules (namespace + quota + netpol + IRSA), Helm app chart, ArgoCD ApplicationSet, and the cost-tagging conventions.

The SSP portal (see `llm-product-poc/`) opens PRs into this repo on behalf of users. A platform engineer reviews and merges; ArgoCD does the rest.

## Layout

```
terraform/
  modules/
    tenant-namespace/   # k8s Namespace + ResourceQuota + LimitRange + NetworkPolicy
    tenant-iam/         # IRSA / Pod Identity role for tenant workloads (scoped to Bedrock/S3)
  tenants/
    _template/          # copy this when onboarding a tenant
helm/
  app/                  # per-service application chart used by ArgoCD
argocd/
  projects/             # AppProject per tenant
  applicationsets/      # ApplicationSet that scans tenants/ for app manifests
tenants/
  _template/            # example tenant directory layout (values.yaml per service)
docs/
  adr/                  # architecture decision records
```

## Tenant onboarding (manual baseline)

1. Copy `terraform/tenants/_template/` to `terraform/tenants/<tenant-domain>/`.
2. Fill in `terraform.tfvars` (tenant id, domain, department, resource quota).
3. Open PR. CI runs `terraform fmt -check` + `terraform validate` + `helm lint`.
4. Platform engineer merges. ArgoCD syncs the tenant project + namespace.

## Tenant onboarding (automated, via SSP)

The SSP portal opens a PR that adds the tenant directory and a service `values.yaml`. The AI agent fills in Dockerfile + CI workflow on the application side. Platform engineer reviews and merges.

## Cost attribution

All tenant resources carry tags from `Tenant.tags`:
- `tenant`, `domain`, `department`, `head_of_department`

These propagate to AWS resources (via Terraform `default_tags`) and to Kubernetes objects (via Helm labels), enabling OpenCost / Split Cost Allocation Data to attribute shared-cluster cost per namespace.

## CI

See `.github/workflows/`:
- `terraform.yml` — fmt-check, validate, tflint
- `helm.yml` — lint, template render
- `argocd-validate.yml` — kubeconform on rendered manifests
