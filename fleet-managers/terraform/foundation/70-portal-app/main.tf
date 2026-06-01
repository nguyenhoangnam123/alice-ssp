terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
  }
}

locals {
  tags = merge(var.default_tags, {
    tenant    = "ssp-portal"
    product   = "ssp-portal"
    component = "portal-app"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
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

data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/55-ecr/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

data "terraform_remote_state" "portal_data" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/60-portal-data/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

data "terraform_remote_state" "cognito" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/30-cognito/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

data "aws_eks_cluster_auth" "this" {
  name = data.terraform_remote_state.eks.outputs.cluster_name
}

locals {
  cluster_endpoint  = data.terraform_remote_state.eks.outputs.cluster_endpoint
  cluster_ca        = data.terraform_remote_state.eks.outputs.cluster_certificate_authority_data
  oidc_provider_arn = data.terraform_remote_state.eks.outputs.oidc_provider_arn
  oidc_provider_url = replace(data.terraform_remote_state.eks.outputs.cluster_oidc_issuer_url, "https://", "")

  portal_repo_url    = data.terraform_remote_state.ecr.outputs.portal_repo_url
  db_secret_arn      = data.terraform_remote_state.portal_data.outputs.db_secret_arn
  db_secret_name     = data.terraform_remote_state.portal_data.outputs.db_secret_name
  cognito_pool_id    = data.terraform_remote_state.cognito.outputs.user_pool_id
  cognito_client_id  = data.terraform_remote_state.cognito.outputs.user_pool_client_id
}

provider "kubernetes" {
  host                   = local.cluster_endpoint
  cluster_ca_certificate = base64decode(local.cluster_ca)
  token                  = data.aws_eks_cluster_auth.this.token
}

provider "helm" {
  kubernetes {
    host                   = local.cluster_endpoint
    cluster_ca_certificate = base64decode(local.cluster_ca)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

provider "kubectl" {
  host                   = local.cluster_endpoint
  cluster_ca_certificate = base64decode(local.cluster_ca)
  token                  = data.aws_eks_cluster_auth.this.token
  load_config_file       = false
}
