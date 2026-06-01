terraform {
  required_version = ">= 1.6.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }
}

locals {
  # K8s labels that drive OpenCost / Split Cost Allocation attribution per namespace.
  # Mirrors the AWS-tag schema used in foundation/terraform.shared.tfvars.
  labels = merge(
    {
      "ssp.platform/tenant"      = var.tenant_id
      "ssp.platform/domain"      = var.tenant_domain
      "ssp.platform/department"  = var.department
      "ssp.platform/cost-center" = var.cost_center
      "ssp.platform/product"     = "ssp-tenant-workload"
      "ssp.platform/environment" = var.environment
      "app.kubernetes.io/managed-by" = "terraform"
    },
    var.extra_labels,
  )
}

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name   = var.namespace
    labels = local.labels
    annotations = {
      "ssp.platform/head-of-department" = var.head_of_department
    }
  }
}

resource "kubernetes_resource_quota_v1" "this" {
  metadata {
    name      = "tenant-quota"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
    labels    = local.labels
  }

  spec {
    hard = {
      "requests.cpu"    = var.quota.cpu_requests
      "requests.memory" = var.quota.memory_requests
      "limits.cpu"      = var.quota.cpu_limits
      "limits.memory"   = var.quota.memory_limits
      "pods"            = var.quota.pods
    }
  }
}

resource "kubernetes_limit_range_v1" "this" {
  metadata {
    name      = "tenant-limits"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
    labels    = local.labels
  }

  spec {
    limit {
      type = "Container"
      default = {
        cpu    = var.default_limits.cpu
        memory = var.default_limits.memory
      }
      default_request = {
        cpu    = var.default_limits.cpu_request
        memory = var.default_limits.memory_request
      }
    }
  }
}

resource "kubernetes_network_policy_v1" "deny_cross_namespace" {
  metadata {
    name      = "deny-cross-namespace"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
    labels    = local.labels
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      from {
        namespace_selector {
          match_labels = {
            "ssp.platform/tenant" = var.tenant_id
          }
        }
      }

      dynamic "from" {
        for_each = var.allowed_ingress_namespaces
        content {
          namespace_selector {
            match_labels = {
              "kubernetes.io/metadata.name" = from.value
            }
          }
        }
      }
    }
  }
}
