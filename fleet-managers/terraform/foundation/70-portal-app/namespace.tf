resource "kubernetes_namespace_v1" "portal" {
  metadata {
    name = "ssp-portal"
    labels = {
      # These labels also drive OpenCost attribution and let the shared Gateway's
      # `from: Selector` match this namespace.
      "ssp.platform/tenant"      = "ssp-portal"
      "ssp.platform/domain"      = "ssp-portal"
      "ssp.platform/department"  = "platform"
      "ssp.platform/cost-center" = "platform-eng"
      "ssp.platform/product"     = "ssp-portal"
      "ssp.platform/environment" = "shared-prod"
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
}
