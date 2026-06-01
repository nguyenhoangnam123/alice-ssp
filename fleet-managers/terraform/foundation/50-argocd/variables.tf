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

variable "argocd_chart_version" {
  type    = string
  default = "7.7.0"
}

variable "fleet_repo_url" {
  type        = string
  description = "GitHub URL of the fleet-managers repo. ArgoCD bootstraps from /argocd/."
  default     = "https://github.com/ORG/fleet-managers.git"
}

variable "fleet_repo_revision" {
  type    = string
  default = "main"
}

variable "argocd_admin_password_bcrypt" {
  type        = string
  description = "Bcrypt hash of the initial admin password. Leave empty to use ArgoCD's auto-generated secret (read via `kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath={.data.password} | base64 -d`)."
  sensitive   = true
  default     = ""
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
