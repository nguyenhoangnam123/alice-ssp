output "web_acl_arn" {
  description = "Pass to LBC via Ingress annotation alb.ingress.kubernetes.io/wafv2-acl-arn."
  value       = aws_wafv2_web_acl.public_alb.arn
}

output "web_acl_id" {
  value = aws_wafv2_web_acl.public_alb.id
}
