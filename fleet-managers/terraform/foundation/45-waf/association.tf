# LBC's wafv2-acl-arn annotation on Gateway resources isn't honored (only on Ingress).
# Explicit association — look up the ALB by the tags LBC stamps on Gateway-provisioned ALBs.

data "aws_lbs" "public_gateway" {
  tags = {
    "elbv2.k8s.aws/cluster"        = "ssp-shared"
    "gateway.k8s.aws.alb/stack"    = "gateway-system/alb-public-shared"
    "gateway.k8s.aws.alb/resource" = "LoadBalancer"
  }
}

resource "aws_wafv2_web_acl_association" "public_alb" {
  count = length(data.aws_lbs.public_gateway.arns) > 0 ? 1 : 0

  resource_arn = tolist(data.aws_lbs.public_gateway.arns)[0]
  web_acl_arn  = aws_wafv2_web_acl.public_alb.arn
}

output "associated_alb_arn" {
  value = length(data.aws_lbs.public_gateway.arns) > 0 ? tolist(data.aws_lbs.public_gateway.arns)[0] : "none"
}
