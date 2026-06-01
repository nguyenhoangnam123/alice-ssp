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
    component = "dns"
  })
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags { tags = local.tags }
}

# Subdomain hosted zone. Parent zone (eaglesoftvn.com) lives at Namecheap; user adds
# the NS records emitted below to Namecheap to delegate this subdomain to Route53.
resource "aws_route53_zone" "ssp" {
  name = var.ssp_zone_name

  comment = "SSP platform — tenants get *.${var.ssp_zone_name} via External-DNS"
}
