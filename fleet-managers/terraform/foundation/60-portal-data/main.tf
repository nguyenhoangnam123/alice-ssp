terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

locals {
  # SSP portal data — tenant=ssp-portal, product=ssp-portal so RDS + Secrets Manager
  # spend rolls up under the portal product.
  tags = merge(var.default_tags, {
    tenant    = "ssp-portal"
    product   = "ssp-portal"
    component = "portal-data"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/10-vpc/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

data "terraform_remote_state" "eks" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/20-eks/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

data "terraform_remote_state" "bootstrap" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/00-bootstrap/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}
