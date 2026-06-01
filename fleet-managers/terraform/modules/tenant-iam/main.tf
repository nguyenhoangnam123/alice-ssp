terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Tag schema must match foundation/terraform.shared.tfvars (tenant / product / cost_center
  # / environment / managed_by / owner). Per-tenant resources override tenant/product/owner;
  # everything else is inherited via var.extra_tags from the tenant tfvars.
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

  oidc_provider_url_no_scheme = replace(var.oidc_provider_url, "https://", "")
}

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url_no_scheme}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account_name}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url_no_scheme}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "ssp-tenant-${var.tenant_domain}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = local.tags
}

data "aws_iam_policy_document" "bedrock" {
  statement {
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = var.bedrock_model_arns
  }
}

data "aws_iam_policy_document" "s3" {
  count = var.s3_bucket_name == null ? 0 : 1

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.s3_bucket_name}/tenants/${var.tenant_id}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.s3_bucket_name}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["tenants/${var.tenant_id}/*"]
    }
  }
}

resource "aws_iam_role_policy" "bedrock" {
  name   = "bedrock-invoke"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.bedrock.json
}

resource "aws_iam_role_policy" "s3" {
  count  = var.s3_bucket_name == null ? 0 : 1
  name   = "s3-tenant-prefix"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.s3[0].json
}
