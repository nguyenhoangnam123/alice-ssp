terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  tags = merge(var.default_tags, {
    component = "cost-governance"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

# Per-cost-center budgets. Each one filters on the `cost_center` resource tag the rest
# of the foundation propagates via default_tags. AWS Budgets fires SNS / email notifications
# at 50/80/100% of the cap (FORECASTED at 100% so we get a heads-up before the cap is hit).
resource "aws_budgets_budget" "cost_center" {
  for_each     = var.cost_centers
  name         = "cc-${each.key}"
  budget_type  = "COST"
  limit_amount = format("%.2f", each.value.monthly_cap_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:cost_center$${each.key}"]
  }

  dynamic "notification" {
    for_each = toset([50, 80])
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_alert_emails
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}

# Overall account guardrail — picks up untagged spend (anything that drifts past the
# default_tags net, e.g. service-linked roles, data transfer on shared infra) so the
# bill can't run away silently.
resource "aws_budgets_budget" "account" {
  name         = "account-overall"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.account_monthly_cap_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset([50, 80, 100])
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_alert_emails
    }
  }
}
