terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "ssp-platform-tfstate-195748744911"
    key            = "tenants/alice/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "ssp-platform-tflock"
    encrypt        = true
    profile        = "alice"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = local.tags
  }
}

data "aws_eks_cluster" "this" {
  name = "ssp-shared"
}

data "aws_eks_cluster_auth" "this" {
  name = "ssp-shared"
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

locals {
  tags = merge(
    {
      tenant             = var.tenant_id
      domain             = var.tenant_domain
      department         = var.department
      cost_center        = var.cost_center
      product            = "ssp-tenant-workload"
      environment        = var.environment
      managed_by         = "terraform"
      owner              = "tenant-${var.tenant_domain}"
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
  extra_tags        = var.extra_tags
}
