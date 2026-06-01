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

variable "vpc_id" {
  type        = string
  description = "Pulled from 10-vpc outputs via remote state — but most charts auto-discover. Kept here for explicit wiring."
  default     = ""
}

variable "gateway_api_version" {
  type        = string
  default     = "v1.2.0"
  description = "Gateway API release tag — installs the standard channel CRDs."
}

variable "alb_controller_chart_version" {
  type        = string
  default     = "3.3.0"
  description = "aws-load-balancer-controller Helm chart version. Chart 3.x (controller v3.x) ships ALBGatewayAPI / NLBGatewayAPI feature gates that actually wire up the Gateway controller."
}

variable "alb_controller_iam_policy_ref" {
  type        = string
  default     = "v2.13.4"
  description = "Git tag of the AWS LB Controller repo whose docs/install/iam_policy.json we use."
}

variable "external_dns_chart_version" {
  type    = string
  default = "1.15.0"
}

variable "cert_manager_chart_version" {
  type    = string
  default = "v1.16.1"
}

variable "eso_chart_version" {
  type    = string
  default = "0.10.4"
}

variable "metrics_server_chart_version" {
  type    = string
  default = "3.12.2"
}

variable "route53_zone_ids" {
  type        = list(string)
  description = "Hosted-zone IDs External-DNS may write to. Use [] to allow all (broader)."
  default     = []
}

variable "letsencrypt_email" {
  type        = string
  description = "Contact email for ACME registration."
}

variable "default_tags" {
  type    = map(string)
  default = {}
}
