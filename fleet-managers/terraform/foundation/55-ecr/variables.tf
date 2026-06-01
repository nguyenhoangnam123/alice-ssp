variable "aws_region" {
  type = string
}

variable "aws_profile" {
  type    = string
  default = "alice"
}

variable "default_tags" {
  type    = map(string)
  default = {}
}

variable "github_owner" {
  type        = string
  default     = "nguyenhoangnam123"
  description = "GitHub user/org that owns the alice-ssp repo. Used in OIDC trust policy."
}

variable "github_repo" {
  type        = string
  default     = "alice-ssp"
  description = "GitHub repo name. Trust policy is scoped to repo:<owner>/<repo>:*."
}
