variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "ssp_zone_name" {
  type        = string
  description = "Subdomain zone hosted in Route53 (parent zone stays at the registrar / other account)."
  default     = "ssp.mightybee.dev"
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
