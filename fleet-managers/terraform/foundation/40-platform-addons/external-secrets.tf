# External Secrets Operator — syncs secrets from AWS Secrets Manager / SSM Parameter Store
# into Kubernetes Secrets. Pairs with the CMK in 00-bootstrap (alias/ssp-platform-secrets).
#
# Tenants reference the shared ClusterSecretStore by name. IAM scoping does the tenant
# isolation: the IRSA role below can only read secrets under the ssp/* prefix; per-tenant
# scoping (ssp/<tenant-id>/*) is enforced when secrets are created.

data "terraform_remote_state" "bootstrap" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/00-bootstrap/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

locals {
  secrets_kms_arn = data.terraform_remote_state.bootstrap.outputs.secrets_kms_key_arn
}

data "aws_iam_policy_document" "eso_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:external-secrets:external-secrets"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "eso" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:*:secret:ssp/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:DescribeParameters",
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:*:parameter/ssp/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [local.secrets_kms_arn]
  }
}

resource "aws_iam_role" "eso" {
  name               = "${local.cluster_name}-external-secrets"
  assume_role_policy = data.aws_iam_policy_document.eso_trust.json
}

resource "aws_iam_policy" "eso" {
  name   = "${local.cluster_name}-external-secrets"
  policy = data.aws_iam_policy_document.eso.json
}

resource "aws_iam_role_policy_attachment" "eso" {
  role       = aws_iam_role.eso.name
  policy_arn = aws_iam_policy.eso.arn
}

resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  namespace        = "external-secrets"
  create_namespace = true
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = var.eso_chart_version

  values = [yamlencode({
    installCRDs = true
    serviceAccount = {
      create = true
      name   = "external-secrets"
      annotations = {
        "eks.amazonaws.com/role-arn" = aws_iam_role.eso.arn
      }
    }
  })]
}

# Cluster-wide store. Tenants reference this by name from ExternalSecret resources.
# Authentication uses the ESO ServiceAccount's IRSA role — IAM does the tenant scoping
# via the ssp/* prefix on resource ARNs.
resource "kubectl_manifest" "cluster_secret_store" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata = {
      name = "aws-secretsmanager"
      labels = {
        "ssp.platform/tenant" = "platform-shared"
      }
    }
    spec = {
      provider = {
        aws = {
          service = "SecretsManager"
          region  = var.aws_region
          auth = {
            jwt = {
              serviceAccountRef = {
                name      = "external-secrets"
                namespace = "external-secrets"
              }
            }
          }
        }
      }
    }
  })
  server_side_apply = true
  depends_on        = [helm_release.external_secrets]
}

resource "kubectl_manifest" "cluster_param_store" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata = {
      name = "aws-ssm-parameter-store"
      labels = {
        "ssp.platform/tenant" = "platform-shared"
      }
    }
    spec = {
      provider = {
        aws = {
          service = "ParameterStore"
          region  = var.aws_region
          auth = {
            jwt = {
              serviceAccountRef = {
                name      = "external-secrets"
                namespace = "external-secrets"
              }
            }
          }
        }
      }
    }
  })
  server_side_apply = true
  depends_on        = [helm_release.external_secrets]
}
