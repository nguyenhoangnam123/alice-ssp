output "db_host" {
  value = aws_db_instance.portal.address
}

output "db_port" {
  value = aws_db_instance.portal.port
}

output "db_name" {
  value = aws_db_instance.portal.db_name
}

output "db_secret_arn" {
  description = "Secrets Manager ARN. The portal namespace's ExternalSecret references this name."
  value       = aws_secretsmanager_secret.portal_db.arn
}

output "db_secret_name" {
  value = aws_secretsmanager_secret.portal_db.name
}
