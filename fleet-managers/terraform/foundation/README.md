# Foundation Terraform

DevOps-owned. Provisions the shared cluster, identity, ingress, and GitOps installation that the per-tenant modules in `terraform/modules/` and `terraform/tenants/` depend on.

## Layers

Each layer is a standalone Terraform root with its own state file. Apply in order; later layers read earlier layer outputs via `terraform_remote_state`.

| # | Layer | Creates | Depends on |
| --- | --- | --- | --- |
| 00 | `00-bootstrap` | S3 state bucket + DynamoDB lock table | (local state, one-shot) |
| 10 | `10-vpc` | VPC, public/private subnets, NAT, route tables, tags for ALB & EKS | 00 |
| 20 | `20-eks` | EKS cluster, managed node group, IAM OIDC provider | 10 |
| 30 | `30-cognito` | Cognito user pool, app client, Hosted UI domain | 00 |
| 40 | `40-platform-addons` | Gateway API CRDs, AWS LB Controller (Gateway API mode), GatewayClasses (`alb-internal`, `alb-public`), External-DNS, cert-manager | 20 |
| 50 | `50-argocd` | ArgoCD via Helm, App-of-Apps pointing at `fleet-managers/argocd/` | 20, 40 |

## Bootstrap

The state backend itself has to come from somewhere — chicken-and-egg. The convention here:

1. `00-bootstrap` applies with **local state**.
2. After apply, copy the printed `backend` block into `00-bootstrap/backend.tf` and run `terraform init -migrate-state` to move local state into S3.
3. Every subsequent layer starts with its `backend.tf` pointing at S3 from day one.

```bash
cd 00-bootstrap
terraform init
terraform apply -var-file=terraform.tfvars
# follow the migration instructions in the output
```

Each layer after that:

```bash
cd ../10-vpc
terraform init
terraform plan -var-file=../terraform.shared.tfvars
terraform apply -var-file=../terraform.shared.tfvars
```

A shared `terraform.shared.tfvars` at this level keeps cluster name, region, environment labels, and AWS account id in one place. Layer-specific overrides go in each layer's own `terraform.tfvars`.

## Ownership

This entire tree is DevOps. The platform team (the SSP portal) does not write here at runtime — onboarding a tenant is a PR against `terraform/tenants/`, which consumes outputs from these layers but never modifies them.

## AWS credentials

All foundation layers default `aws_profile = "alice"`. Override via:

```bash
terraform apply -var aws_profile=other-profile
# or
terraform apply -var aws_profile=""   # falls back to AWS_PROFILE env var / instance role
```

Verify before applying anything:

```bash
aws sts get-caller-identity --profile alice
```

## Tagging

Foundation infra is tagged `tenant=platform-shared` (or `tenant=ssp-portal` for Cognito,
which is portal-app-specific). Per-tenant modules override with the real tenant id +
domain + department + cost_center. See [docs/adr/0003-tag-policy.md](../../docs/adr/0003-tag-policy.md) for the full schema and the OpenCost / Cost Explorer activation steps.

## Cost note (idle, eu-west-1, MVP1 sizing)

- EKS control plane: ~$73/mo
- NAT Gateway (single AZ): ~$32/mo + traffic
- Internal + public ALB (created on first Gateway apply): ~$16/mo each
- t3.medium node group (2 nodes): ~$60/mo
- Total idle: **~$200/mo** before any tenant workload runs.

If you want to save the NAT cost during dev, set `single_nat_gateway = true` and `enable_nat_gateway = false` in 10-vpc and use VPC endpoints for ECR/S3/STS instead.
