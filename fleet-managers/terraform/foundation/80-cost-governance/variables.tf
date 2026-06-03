variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "aws_account_id" {
  type = string
}

variable "default_tags" {
  type = map(string)
}

# Map of cost_center name → monthly soft cap (USD). Each entry produces an AWS Budget
# scoped via the CostFilters tag. Names must match the `cost_center` tag value on the
# resources you want to track.
variable "cost_centers" {
  type = map(object({
    monthly_cap_usd = number
  }))
  default = {
    "platform-eng" = { monthly_cap_usd = 80 }
    "alice"        = { monthly_cap_usd = 30 }
  }
}

# Overall account cap — separate from cost-center budgets; catches anything that's
# untagged or escapes per-tenant limits.
variable "account_monthly_cap_usd" {
  type    = number
  default = 150
}

# Where to send budget threshold alerts. Up to 10 addresses per Budget per AWS docs.
variable "budget_alert_emails" {
  type    = list(string)
  default = ["namnh21894@gmail.com"]
}
