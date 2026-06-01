output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "state_dynamodb_table" {
  value = aws_dynamodb_table.tflock.name
}

output "secrets_kms_key_arn" {
  description = "ARN of the CMK for SSP secrets. Pass to ESO IRSA policy, SOPS .sops.yaml, etc."
  value       = aws_kms_key.secrets.arn
}

output "secrets_kms_key_id" {
  value = aws_kms_key.secrets.key_id
}

output "secrets_kms_alias" {
  description = "Alias for the CMK (alias/ssp-platform-secrets). Use this in tooling so the key can be rotated without changing references."
  value       = aws_kms_alias.secrets.name
}
