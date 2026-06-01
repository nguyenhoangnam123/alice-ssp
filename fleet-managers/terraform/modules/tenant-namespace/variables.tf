variable "tenant_id" {
  type        = string
  description = "UUID of the tenant from the SSP database. Used as label for cost attribution and NetworkPolicy selectors."
}

variable "tenant_domain" {
  type        = string
  description = "Immutable domain identifier for the tenant."
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace name. Convention: tenant-<domain-slug>."
}

variable "department" {
  type        = string
  description = "Department label, propagated to AWS for cost attribution."
}

variable "head_of_department" {
  type        = string
  description = "Email or LDAP of the head of department. Stored as annotation."
}

variable "quota" {
  type = object({
    cpu_requests    = string
    memory_requests = string
    cpu_limits      = string
    memory_limits   = string
    pods            = string
  })
  description = "ResourceQuota for the namespace."
  default = {
    cpu_requests    = "2"
    memory_requests = "4Gi"
    cpu_limits      = "4"
    memory_limits   = "8Gi"
    pods            = "20"
  }
}

variable "default_limits" {
  type = object({
    cpu            = string
    memory         = string
    cpu_request    = string
    memory_request = string
  })
  description = "Default per-container LimitRange."
  default = {
    cpu            = "500m"
    memory         = "512Mi"
    cpu_request    = "100m"
    memory_request = "128Mi"
  }
}

variable "allowed_ingress_namespaces" {
  type        = list(string)
  description = "Namespaces (e.g. shared ingress, argocd) allowed to reach pods in this tenant."
  default     = ["ingress-nginx", "argocd"]
}

variable "extra_labels" {
  type        = map(string)
  description = "Additional labels from Tenant.tags (cost attribution)."
  default     = {}
}

variable "cost_center" {
  type    = string
  default = "platform-eng"
}

variable "environment" {
  type    = string
  default = "shared-prod"
}
