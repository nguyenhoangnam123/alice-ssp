# 80-cost-governance

Per-tenant cost visibility + alerting. Two layers:

1. **AWS Budgets per `cost_center`** — soft monthly cap on each tenant's tag-scoped
   spend (Cost Explorer filter: `user:cost_center=<value>`). Notifies at 50/80%
   actual + 100% forecasted via email.
2. **Account-overall Budget** — catches anything untagged or that escapes the per-tag
   filters (service-linked roles, NAT gateway data transfer, etc.).

## One-time activation (cannot be Terraformed — billing-account scope)

These two steps must be done **once** by an admin with billing console access. They're
account-wide flags, not in any region or service.

### a) Enable Cost Explorer

Console → **Billing → Cost Explorer → Enable**. Takes ~24h for data to populate.

### b) Activate cost-allocation tags

Console → **Billing → Cost allocation tags → User-defined**. Activate at least:

- `cost_center`
- `tenant`
- `product`
- `environment`

Until these are activated, the per-cost-center budgets here will return $0 spend
even if everything is tagged — AWS only aggregates spend by tags that have been
explicitly activated for billing.

## Apply

```sh
AWS_PROFILE=alice terraform init
AWS_PROFILE=alice terraform apply -var-file ../terraform.shared.tfvars
```

## Adjusting caps / adding tenants

Edit `var.cost_centers` in `variables.tf` (or pass `-var` at apply). Adding a new
cost center is one map entry — the `for_each` produces a budget+notifications stack
without touching the rest.
