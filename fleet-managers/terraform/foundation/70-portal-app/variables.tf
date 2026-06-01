variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "state_bucket_name" {
  type = string
}

variable "image_tag" {
  type        = string
  description = "ECR image tag for the portal. Defaults to 'latest' — pin to a git sha for production rollouts."
  default     = "latest"
}

variable "hostname" {
  type    = string
  default = "portal.ssp.mightybee.dev"
}

variable "replicas" {
  type    = number
  default = 1
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
