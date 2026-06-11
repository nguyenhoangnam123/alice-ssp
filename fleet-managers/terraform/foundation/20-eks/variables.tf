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
  # Bumped from 1.30 → 1.34 to exit Extended Support pricing (~$0.50/hour
  # surcharge on 1.30, which was ~$360/month). 1.34 stays on standard
  # support until ~Oct 2026 (gives ~4 months runway). Done as four
  # sequential terraform-apply hops (1.30→1.31→1.32→1.33→1.34) because
  # EKS forbids minor-version skipping. The terraform-aws-modules/eks
  # module auto-bumps cluster_addons + the managed node group when this
  # value changes.
  default = "1.34"
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
  # Single-node evaluation environment. Saves ~$30/mo vs. min=2 but loses
  # HA — any node failure or AMI rotation is full-outage downtime until a
  # replacement node joins. Keep max=6 so the next EKS upgrade can still
  # surge during rolling node replacement.
  default = 1
}

variable "node_max_size" {
  type    = number
  default = 6
}

variable "node_desired_size" {
  type    = number
  default = 1
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
