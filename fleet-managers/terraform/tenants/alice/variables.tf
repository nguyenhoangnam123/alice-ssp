variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "tenant_id" {
  type    = string
  default = "cbdbfcd6373448318d82ddc58d"
}

variable "tenant_domain" {
  type    = string
  default = "alice"
}

variable "department" {
  type    = string
  default = "platform"
}

variable "head_of_department" {
  type    = string
  default = "ngminhhieu1510@gmail.com"
}

variable "cost_center" {
  type    = string
  default = "platform-eng"
}

variable "environment" {
  type    = string
  default = "shared-prod"
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
  type    = string
  default = "arn:aws:iam::195748744911:oidc-provider/oidc.eks.eu-west-1.amazonaws.com/id/25AA1D094E60CFEC27C8361C0FF6506C"
}

variable "oidc_provider_url" {
  type    = string
  default = "https://oidc.eks.eu-west-1.amazonaws.com/id/25AA1D094E60CFEC27C8361C0FF6506C"
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
