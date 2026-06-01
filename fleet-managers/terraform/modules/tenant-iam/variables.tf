variable "tenant_id" {
  type        = string
  description = "UUID of the tenant from the SSP database."
}

variable "tenant_domain" {
  type        = string
  description = "Immutable tenant domain (slug-safe). Used in role name."
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace whose ServiceAccount is permitted to assume this role."
}

variable "service_account_name" {
  type        = string
  description = "ServiceAccount name in the tenant namespace (typically 'default' or 'app')."
  default     = "default"
}

variable "department" {
  type        = string
  description = "Cost-attribution tag."
}

variable "head_of_department" {
  type        = string
  description = "Cost-attribution tag."
}

variable "oidc_provider_arn" {
  type        = string
  description = "ARN of the cluster OIDC provider, e.g. arn:aws:iam::123:oidc-provider/oidc.eks.eu-west-1.amazonaws.com/id/ABCDEF"
}

variable "oidc_provider_url" {
  type        = string
  description = "URL of the cluster OIDC provider, e.g. https://oidc.eks.eu-west-1.amazonaws.com/id/ABCDEF"
}

variable "bedrock_model_arns" {
  type        = list(string)
  description = "Bedrock model ARNs the tenant may invoke."
  default = [
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-sonnet-*",
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-*",
  ]
}

variable "s3_bucket_name" {
  type        = string
  description = "Optional shared S3 bucket. Role gets access only to tenants/<tenant_id>/* prefix."
  default     = null
}

variable "extra_tags" {
  type        = map(string)
  description = "Extra cost-attribution tags from Tenant.tags."
  default     = {}
}

variable "cost_center" {
  type        = string
  description = "Cost center for this tenant's AWS spend. Convention: <department>-eng."
  default     = "platform-eng"
}

variable "environment" {
  type    = string
  default = "shared-prod"
}
