variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "cluster_name" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "az_count" {
  type    = number
  default = 3
}

variable "single_nat_gateway" {
  type        = bool
  default     = false
  description = "Set to true to save ~$60/mo in dev. Production should use one NAT per AZ."
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
