terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Bootstrap layer intentionally has NO backend block — it runs with local state.
  # After apply, add a backend.tf pointing at the bucket this module created and
  # run `terraform init -migrate-state` to move local state into S3.
}

locals {
  tags = merge(var.default_tags, {
    component = "state-backend"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tflock" {
  name         = var.state_dynamodb_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

output "next_steps" {
  value = <<-EOT

    Bootstrap complete. To migrate state into S3 and lock subsequent applies:

      cat > backend.tf <<EOF
      terraform {
        backend "s3" {
          bucket         = "${aws_s3_bucket.tfstate.bucket}"
          key            = "foundation/00-bootstrap/terraform.tfstate"
          region         = "${var.aws_region}"
          dynamodb_table = "${aws_dynamodb_table.tflock.name}"
          encrypt        = true
        }
      }
      EOF
      terraform init -migrate-state

    Each subsequent layer (10-vpc, 20-eks, ...) already has its backend.tf pre-wired
    against this bucket and table; just `terraform init` them.
  EOT
}
