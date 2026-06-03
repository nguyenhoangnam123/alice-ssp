# IRSA role bound to the portal's ServiceAccount. Currently scoped to Bedrock InvokeModel
# on Claude foundation models so the AI agent can run real inference.
data "aws_iam_policy_document" "portal_trust" {
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
      values   = ["system:serviceaccount:ssp-portal:ssp-portal-app"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "portal" {
  # Foundation models — direct ARN + cross-region inference profile ARN.
  statement {
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/eu.anthropic.claude-*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:application-inference-profile/*",
    ]
  }

  # Per-service secrets management. The portal mediates writes on behalf of
  # tenants (no direct cloud creds in tenant pods). Scoped to the ssp/* prefix
  # so a compromised portal can't touch unrelated account secrets.
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:TagResource",
    ]
    resources = [
      "arn:aws:secretsmanager:*:${data.aws_caller_identity.current.account_id}:secret:ssp/*",
    ]
  }

  # ListSecrets has to be * (no resource-level scoping in IAM for the list
  # action). The portal filters results client-side to ssp/<tenant>/* paths.
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  # CMK that ssp/* secrets are encrypted under. Without this the portal can't
  # decrypt during GetSecretValue or encrypt during Put.
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]
    resources = [
      "arn:aws:kms:*:${data.aws_caller_identity.current.account_id}:alias/ssp-platform-secrets",
      "arn:aws:kms:*:${data.aws_caller_identity.current.account_id}:key/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_caller_identity.current.id != "" ? "*" : "eu-west-1"}.amazonaws.com"]
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "portal" {
  name               = "ssp-portal-app"
  assume_role_policy = data.aws_iam_policy_document.portal_trust.json
}

resource "aws_iam_role_policy" "portal" {
  name   = "bedrock-invoke"
  role   = aws_iam_role.portal.id
  policy = data.aws_iam_policy_document.portal.json
}

output "portal_role_arn" {
  value = aws_iam_role.portal.arn
}
