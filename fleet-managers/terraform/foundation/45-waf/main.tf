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
    component = "waf"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags {
    tags = local.tags
  }
}

# Single regional WebACL for every public ALB the SSP cluster fronts. Per-Ingress
# association is via the alb.ingress.kubernetes.io/wafv2-acl-arn annotation, which the LBC
# translates into an aws_wafv2_web_acl_association. This way Terraform owns the policy and
# the GitOps repo owns *which* services opt in.
resource "aws_wafv2_web_acl" "public_alb" {
  name        = "ssp-shared-public-alb"
  description = "WAF for SSP public ALBs - managed rules + IP reputation + rate limit"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "ssp_public_alb"
  }

  # ----- Allow-list at priority 1 --------------------------------------------------------
  # Allow action terminates rule evaluation — webhook endpoints (signed payloads verified
  # by the app's HMAC check) skip the managed rule groups so legitimate PR payloads
  # containing code-like content (SQL-ish strings, shell snippets) aren't blocked.
  rule {
    name     = "AllowWebhookEndpoints"
    priority = 1
    action {
      allow {}
    }
    statement {
      byte_match_statement {
        positional_constraint = "STARTS_WITH"
        search_string         = "/api/webhooks/"
        field_to_match {
          uri_path {}
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "webhook_allow"
    }
  }

  # ArgoCD UI also bypasses the managed rules. ArgoCD has its own RBAC + login; the API
  # JSON payloads frequently include code-like strings (sync hooks, k8s manifests) that
  # false-trigger CommonRuleSet / SQLi rules. The hostname is locked to argocd.ssp.mightybee.dev.
  rule {
    name     = "AllowArgoCDHost"
    priority = 5
    action {
      allow {}
    }
    statement {
      byte_match_statement {
        positional_constraint = "EXACTLY"
        search_string         = "argocd.ssp.mightybee.dev"
        field_to_match {
          single_header {
            name = "host"
          }
        }
        text_transformation {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "argocd_allow"
    }
  }

  # ----- AWS managed rule groups ---------------------------------------------------------
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "common_rules"
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "known_bad_inputs"
    }
  }

  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "ip_reputation"
    }
  }

  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 40
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "sqli"
    }
  }

  # ----- Rate limiting -------------------------------------------------------------------
  # Throws a 429 once a single IP exceeds the threshold within a rolling 5-minute window.
  rule {
    name     = "RateLimitPerIp"
    priority = 100
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "rate_limit"
    }
  }
}

# CloudWatch Log Group for sampled / blocked requests. 1-day retention keeps it
# inside the CW free tier — bump for incident retros if needed.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-ssp-shared-public-alb"
  retention_in_days = 1
}

resource "aws_wafv2_web_acl_logging_configuration" "public_alb" {
  resource_arn            = aws_wafv2_web_acl.public_alb.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # Redact sensitive headers so the log group doesn't contain bearer tokens / cookies.
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}
