# GitHub OIDC trust — lets GitHub Actions assume an IAM role in this account using a JWT,
# no long-lived AWS access keys. Single provider per account.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # AWS auto-discovers and validates the thumbprint at use-time; this value is the standard
  # GitHub Actions root CA fingerprint as a hint.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "gha_portal_build_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only the alice-ssp repo can assume this role, on any branch / PR.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repo}:*"]
    }
  }
}

data "aws_iam_policy_document" "gha_portal_build" {
  # ECR auth token must be scoped to *. ECR API quirk.
  statement {
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Repo-scoped push/pull on the portal repo only.
  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.portal.arn]
  }
}

resource "aws_iam_role" "gha_portal_build" {
  name               = "ssp-github-actions-portal-build"
  assume_role_policy = data.aws_iam_policy_document.gha_portal_build_trust.json
}

resource "aws_iam_role_policy" "gha_portal_build" {
  name   = "ecr-push"
  role   = aws_iam_role.gha_portal_build.id
  policy = data.aws_iam_policy_document.gha_portal_build.json
}

output "gha_portal_build_role_arn" {
  value = aws_iam_role.gha_portal_build.arn
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github_actions.arn
}
