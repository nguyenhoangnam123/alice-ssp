output "gatewayclass_internal" {
  value = "alb-internal"
}

output "gatewayclass_public" {
  value = "alb-public"
}

output "alb_controller_role_arn" {
  value = aws_iam_role.alb_controller.arn
}

output "external_dns_role_arn" {
  value = aws_iam_role.external_dns.arn
}

output "external_secrets_role_arn" {
  value = aws_iam_role.eso.arn
}

output "secrets_kms_key_arn" {
  description = "Inherited from 00-bootstrap. Use this when creating Secrets Manager entries (KmsKeyId) so ESO can decrypt."
  value       = local.secrets_kms_arn
}
