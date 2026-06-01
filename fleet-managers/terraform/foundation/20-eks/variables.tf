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

variable "cluster_name" {
  type = string
}

variable "cluster_version" {
  type    = string
  default = "1.30"
}

variable "cluster_endpoint_public_access" {
  type        = bool
  default     = true
  description = "Set to false once VPN access is in place."
}

variable "node_instance_types" {
  type    = list(string)
  default = ["t3.medium"]
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 6
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
