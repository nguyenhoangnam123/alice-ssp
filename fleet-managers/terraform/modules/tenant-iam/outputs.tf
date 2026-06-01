output "role_arn" {
  description = "ARN of the IRSA role. Annotate this on the tenant ServiceAccount."
  value       = aws_iam_role.this.arn
}

output "role_name" {
  description = "Name of the IRSA role."
  value       = aws_iam_role.this.name
}

output "service_account_annotation" {
  description = "Annotation to put on the tenant ServiceAccount."
  value = {
    "eks.amazonaws.com/role-arn" = aws_iam_role.this.arn
  }
}
