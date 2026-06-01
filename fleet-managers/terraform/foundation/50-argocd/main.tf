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
    component = "gitops-argocd"
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
    bucket = var.state_bucket_name
    key    = "foundation/20-eks/terraform.tfstate"
    region = var.aws_region
  }
}

data "aws_eks_cluster_auth" "this" {
  name = data.terraform_remote_state.eks.outputs.cluster_name
}

locals {
  cluster_endpoint = data.terraform_remote_state.eks.outputs.cluster_endpoint
  cluster_ca       = data.terraform_remote_state.eks.outputs.cluster_certificate_authority_data
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
