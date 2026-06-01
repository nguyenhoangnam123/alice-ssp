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

variable "hosted_ui_domain" {
  type        = string
  description = "Subdomain on auth.<region>.amazoncognito.com (must be globally unique within that region)."
}

variable "portal_callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/api/auth/callback"]
}

variable "portal_logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000"]
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
