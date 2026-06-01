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
  # ECR repo for the SSP portal app — tenant=ssp-portal so its cost rolls up under the
  # portal product, not the shared-platform bucket.
  tags = merge(var.default_tags, {
    tenant    = "ssp-portal"
    product   = "ssp-portal"
    component = "container-registry"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

resource "aws_ecr_repository" "portal" {
  name                 = "ssp-portal"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "portal" {
  repository = aws_ecr_repository.portal.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
