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
