# Shared Gateways — one per scheme (internal / public). HTTPRoutes in tenant namespaces
# attach via parentRefs.namespace=gateway-system. Listener's allowedRoutes.namespaces.selector
# permits any namespace carrying ssp.platform/tenant label (which tenant-namespace module
# applies). Cheaper than one ALB per tenant.
resource "kubernetes_namespace_v1" "gateway_system" {
  metadata {
    name = "gateway-system"
    labels = {
      "ssp.platform/managed-by"  = "terraform"
      "ssp.platform/tenant"      = "platform-shared"
      "ssp.platform/product"     = "ssp-platform"
      "ssp.platform/component"   = "shared-gateway"
    }
  }
}

resource "kubectl_manifest" "shared_gateway_internal" {
  yaml_body = yamlencode({
    apiVersion = "gateway.networking.k8s.io/v1"
    kind       = "Gateway"
    metadata = {
      name      = "alb-internal-shared"
      namespace = "gateway-system"
      labels = {
        "ssp.platform/tenant" = "platform-shared"
      }
      annotations = {
        # LBC reads this annotation to decide internal vs internet-facing ALB.
        "alb.ingress.kubernetes.io/scheme" = "internal"
      }
    }
    spec = {
      gatewayClassName = "alb-internal"
      listeners = [{
        name     = "http"
        port     = 80
        protocol = "HTTP"
        allowedRoutes = {
          namespaces = {
            from = "Selector"
            selector = {
              matchExpressions = [{
                key      = "ssp.platform/tenant"
                operator = "Exists"
              }]
            }
          }
        }
      }]
    }
  })
  server_side_apply = true
  depends_on = [
    kubectl_manifest.gatewayclass_alb_internal,
    kubernetes_namespace_v1.gateway_system,
  ]
}

resource "kubectl_manifest" "shared_gateway_public" {
  yaml_body = yamlencode({
    apiVersion = "gateway.networking.k8s.io/v1"
    kind       = "Gateway"
    metadata = {
      name      = "alb-public-shared"
      namespace = "gateway-system"
      labels = {
        "ssp.platform/tenant" = "platform-shared"
      }
      annotations = {
        "alb.ingress.kubernetes.io/scheme" = "internet-facing"
      }
    }
    spec = {
      gatewayClassName = "alb-public"
      listeners = [{
        name     = "http"
        port     = 80
        protocol = "HTTP"
        allowedRoutes = {
          namespaces = {
            from = "Selector"
            selector = {
              matchExpressions = [{
                key      = "ssp.platform/tenant"
                operator = "Exists"
              }]
            }
          }
        }
      }]
    }
  })
  depends_on = [
    kubectl_manifest.gatewayclass_alb_public,
    kubernetes_namespace_v1.gateway_system,
  ]
}
