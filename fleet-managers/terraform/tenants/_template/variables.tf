variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "cost_center" {
  type        = string
  description = "Cost center, typically <department>-eng. Drives AWS Cost Explorer rollup."
  default     = "platform-eng"
}

variable "environment" {
  type    = string
  default = "shared-prod"
}

variable "tenant_id" {
  type        = string
  description = "UUID from the SSP database."
}

variable "tenant_domain" {
  type        = string
  description = "Immutable slug-safe tenant domain."
}

variable "department" {
  type = string
}

variable "head_of_department" {
  type = string
}

variable "quota" {
  type = object({
    cpu_requests    = string
    memory_requests = string
    cpu_limits      = string
    memory_limits   = string
    pods            = string
  })
  default = {
    cpu_requests    = "2"
    memory_requests = "4Gi"
    cpu_limits      = "4"
    memory_limits   = "8Gi"
    pods            = "20"
  }
}

variable "oidc_provider_arn" {
  type = string
}

variable "oidc_provider_url" {
  type = string
}

variable "s3_bucket_name" {
  type    = string
  default = null
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
