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
    component = "eks-control-plane"
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
    bucket = var.state_bucket_name
    key    = "foundation/10-vpc/terraform.tfstate"
    region = var.aws_region
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  vpc_id                   = data.terraform_remote_state.vpc.outputs.vpc_id
  subnet_ids               = data.terraform_remote_state.vpc.outputs.private_subnet_ids
  control_plane_subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids

  enable_cluster_creator_admin_permissions = true
  cluster_endpoint_public_access           = var.cluster_endpoint_public_access

  # CW free-tier guard. The module's default is to enable all 5 control-plane log types
  # AND keep them at 90 days — that's how /aws/eks/<cluster>/cluster grew to ~800MB on a
  # POC. For MVP1 we don't operate the control plane (managed by AWS), so disable all
  # types upstream. If a future debug session needs api/audit, re-enable temporarily.
  cluster_enabled_log_types              = []
  cloudwatch_log_group_retention_in_days = 1

  cluster_addons = {
    coredns                = {}
    kube-proxy             = {}
    vpc-cni                = {}
    eks-pod-identity-agent = {} # modern alternative to IRSA — both supported in parallel
    # aws-ebs-csi-driver intentionally omitted in MVP1: nothing in the cluster requests EBS
    # PVCs (portal uses RDS, ArgoCD/ESO/cert-manager are stateless). Re-enable in MVP2 with
    # an IRSA/Pod-Identity role attached via service_account_role_arn or pod_identity_association.
  }

  # Use Pod Identity by default — IRSA OIDC is still provisioned (see below) for addons
  # / external tools that haven't migrated yet.
  enable_irsa = true

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = var.node_instance_types
      min_size       = var.node_min_size
      max_size       = var.node_max_size
      desired_size   = var.node_desired_size

      labels = {
        "ssp.platform/pool" = "default"
      }
    }
  }

  tags = local.tags
}
