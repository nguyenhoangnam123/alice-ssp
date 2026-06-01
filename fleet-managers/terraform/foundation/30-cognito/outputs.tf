output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.portal.id
}

output "user_pool_client_secret" {
  value     = aws_cognito_user_pool_client.portal.client_secret
  sensitive = true
}

output "hosted_ui_url" {
  value = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${var.aws_region}.amazoncognito.com"
}
