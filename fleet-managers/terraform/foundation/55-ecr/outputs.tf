output "portal_repo_url" {
  value = aws_ecr_repository.portal.repository_url
}

output "portal_repo_arn" {
  value = aws_ecr_repository.portal.arn
}

output "registry_id" {
  value = aws_ecr_repository.portal.registry_id
}
