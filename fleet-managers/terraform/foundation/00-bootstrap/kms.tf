# Customer-managed KMS key for SSP platform secrets.
#
# Two intended uses:
#   1. Secrets bootstrap — SOPS-encrypted YAML committed to git (`sops -e --kms <arn>`),
#      decrypted at apply time. Used to seed long-lived secrets like the SSP DB password
#      or the GitHub App private key before ESO is up.
#   2. External Secrets Operator (ESO) — Secrets in AWS Secrets Manager / SSM Parameter
#      Store are encrypted with this CMK. The ESO IRSA role (provisioned by
#      40-platform-addons in a follow-up) is granted kms:Decrypt on this key alone.
#
# Cost: ~$1/mo per CMK; key rotation included.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "secrets_kms" {
  statement {
    sid     = "EnableRootAdmin"
    effect  = "Allow"
    actions = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # The principal that runs Terraform (alice-poc) can use the key without going through
  # IAM policies. Lets the platform engineer do ad-hoc `aws kms encrypt/decrypt` for SOPS
  # workflows.
  statement {
    sid    = "AllowKeyUsageByBootstrapPrincipal"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.arn]
    }
  }
}

resource "aws_kms_key" "secrets" {
  description             = "SSP platform — secrets bootstrap (SOPS) + External Secrets Operator"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.secrets_kms.json

  tags = merge(local.tags, {
    component = "secrets-kms"
  })
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/ssp-platform-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}
