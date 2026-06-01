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
  # Cognito is dedicated to the SSP portal app — override tenant + product so its cost
  # rolls up under the portal product, not shared platform infra.
  tags = merge(var.default_tags, {
    tenant    = "ssp-portal"
    product   = "ssp-portal"
    component = "auth"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

# Single user pool for the whole company — MVP1 design. RBAC scope is enforced inside the
# portal via UserTenant rows, not by Cognito groups.
resource "aws_cognito_user_pool" "this" {
  name = "${var.cluster_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # platform team invites users; no self-signup
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 5
      max_length = 256
    }
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.hosted_ui_domain
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "portal" {
  name         = "ssp-portal"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  callback_urls = var.portal_callback_urls
  logout_urls   = var.portal_logout_urls

  supported_identity_providers = ["COGNITO"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60   # minutes
  id_token_validity             = 60
  refresh_token_validity        = 30   # days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# A placeholder group for the MVP1 tenant-admin role. Real RBAC is in UserTenant —
# this group just lets you mark "platform engineer" users for future use.
resource "aws_cognito_user_group" "platform_engineer" {
  name         = "platform-engineer"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Platform-team operators who can review PRs and manage tenants."
  precedence   = 10
}
