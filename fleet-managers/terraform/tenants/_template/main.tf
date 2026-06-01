# Per-tenant Terraform entrypoint. Copy this directory to terraform/tenants/<tenant-domain>/.
# The SSP portal opens a PR that does exactly this copy + tfvars fill.

terraform {
  required_version = ">= 1.6.0"

  # State backend is set per environment. Override in CI via -backend-config.
  backend "s3" {
    # bucket  = "ssp-platform-tfstate"
    # key     = "tenants/<tenant-domain>/terraform.tfstate"
    # region  = "eu-west-1"
    # encrypt = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = local.tags
  }
}

provider "kubernetes" {
  # Configured via KUBECONFIG / cluster context — DevOps sets this in CI.
}

locals {
  # See foundation/terraform.shared.tfvars for the canonical tag schema.
  tags = merge(
    {
      tenant       = var.tenant_id
      domain       = var.tenant_domain
      department   = var.department
      cost_center  = var.cost_center
      product      = "ssp-tenant-workload"
      environment  = var.environment
      managed_by   = "terraform"
      owner        = "tenant-${var.tenant_domain}"
      head_of_department = var.head_of_department
    },
    var.extra_tags,
  )
}

module "namespace" {
  source = "../../modules/tenant-namespace"

  tenant_id          = var.tenant_id
  tenant_domain      = var.tenant_domain
  namespace          = "tenant-${var.tenant_domain}"
  department         = var.department
  head_of_department = var.head_of_department
  cost_center        = var.cost_center
  environment        = var.environment
  quota              = var.quota
  extra_labels       = var.extra_tags
}

module "iam" {
  source = "../../modules/tenant-iam"

  tenant_id          = var.tenant_id
  tenant_domain      = var.tenant_domain
  namespace          = module.namespace.namespace
  department         = var.department
  head_of_department = var.head_of_department
  cost_center        = var.cost_center
  environment        = var.environment

  oidc_provider_arn = var.oidc_provider_arn
  oidc_provider_url = var.oidc_provider_url
  s3_bucket_name    = var.s3_bucket_name
  extra_tags        = var.extra_tags
}
