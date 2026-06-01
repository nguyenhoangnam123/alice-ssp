# Module: tenant-iam

Creates an IRSA-compatible IAM role for a tenant. The role is trusted by the cluster OIDC provider for a specific ServiceAccount in the tenant namespace.

Default policies attached:
- `bedrock:InvokeModel` on Claude foundation models
- (Optional) `s3:*` scoped to `tenants/<tenant_id>/*` prefix in a shared bucket

## Usage

```hcl
module "tenant_acme_iam" {
  source = "../../modules/tenant-iam"

  tenant_id            = "01H8XQK..."
  tenant_domain        = "acme"
  namespace            = "tenant-acme"
  service_account_name = "default"
  department           = "growth"
  head_of_department   = "jane.doe@example.com"

  oidc_provider_arn = data.aws_eks_cluster.shared.identity[0].oidc[0].issuer  # use the IAM OIDC provider ARN created at cluster bootstrap
  oidc_provider_url = data.aws_eks_cluster.shared.identity[0].oidc[0].issuer
}
```

Then in the tenant's Helm values, annotate the ServiceAccount:

```yaml
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: <module.tenant_acme_iam.role_arn>
```
