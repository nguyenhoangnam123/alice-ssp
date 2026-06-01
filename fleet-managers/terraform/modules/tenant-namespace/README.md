# Module: tenant-namespace

Creates the Kubernetes-side foundation for a tenant:
- `Namespace` labeled with `ssp.platform/tenant`, `ssp.platform/domain`, `ssp.platform/department`
- `ResourceQuota` (CPU/memory/pod caps)
- `LimitRange` (per-container defaults)
- `NetworkPolicy` denying cross-namespace ingress except for `argocd` and `ingress-nginx` (override via `allowed_ingress_namespaces`)

Pairs with `tenant-iam` for IRSA / Pod Identity.

## Usage

```hcl
module "tenant_acme" {
  source = "../../modules/tenant-namespace"

  tenant_id          = "01H8XQK..."
  tenant_domain      = "acme"
  namespace          = "tenant-acme"
  department         = "growth"
  head_of_department = "jane.doe@example.com"

  quota = {
    cpu_requests    = "4"
    memory_requests = "8Gi"
    cpu_limits      = "8"
    memory_limits   = "16Gi"
    pods            = "40"
  }

  extra_labels = {
    "ssp.platform/cost-center" = "growth-eng"
  }
}
```
