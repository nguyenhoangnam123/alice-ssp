# Per-app IRSA role for the chat tenant Deployment. Trust is locked to
# system:serviceaccount:tenant-alice:alice-chat-app — narrower than the
# tenant-wide role, which means a future tenant-alice app cannot assume
# this role.
#
# Permissions: bedrock:InvokeModel on Claude models (so chat can call
# Bedrock from its own pod, not via the portal) + kms:Decrypt scoped to
# Secrets Manager calls (so the mounted portal-* secrets are decryptable).
# No KMS encrypt; no SM write; no DB IAM (DB is reached over IP).
#
# Replaces the temporary shortcut where chat's serviceAccount annotation
# pointed at the portal's role — that trust didn't admit the chat SA, so
# AssumeRoleWithWebIdentity was failing with AccessDenied.

# The oidc_provider_url variable already includes https://; strip it for
# the IAM condition variable, which expects bare host+path.
locals {
  oidc_issuer_id = trimprefix(var.oidc_provider_url, "https://")
}

data "aws_iam_policy_document" "chat_app_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_id}:sub"
      values   = ["system:serviceaccount:tenant-alice:alice-chat-app"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_id}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "chat_app" {
  # Bedrock — foundation model + EU cross-region inference profile ARNs.
  statement {
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:*:*:inference-profile/eu.anthropic.claude-*",
      "arn:aws:bedrock:*:*:application-inference-profile/*",
    ]
  }

  # KMS — decrypt the ssp-platform-secrets CMK only via Secrets Manager.
  # The chat pod mounts portal-db / portal-cognito / portal-internal-token,
  # all encrypted under this CMK. Without ViaService condition, this could
  # decrypt other things encrypted under the same key — the condition pins
  # to SM-mediated reads only.
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [
      "arn:aws:kms:eu-west-1:195748744911:alias/ssp-platform-secrets",
      "arn:aws:kms:eu-west-1:195748744911:key/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.eu-west-1.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "chat_app" {
  name               = "ssp-tenant-alice-chat"
  assume_role_policy = data.aws_iam_policy_document.chat_app_trust.json

  tags = merge(local.tags, {
    component = "tenant-app-irsa"
    app       = "chat"
  })
}

resource "aws_iam_role_policy" "chat_app" {
  name   = "chat-app"
  role   = aws_iam_role.chat_app.id
  policy = data.aws_iam_policy_document.chat_app.json
}

output "chat_app_role_arn" {
  value = aws_iam_role.chat_app.arn
}
