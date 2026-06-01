resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  namespace        = "cert-manager"
  create_namespace = true
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = var.cert_manager_chart_version

  values = [yamlencode({
    crds = {
      enabled = true
    }
    # Enable Gateway API listener support — issues certs from Gateway/HTTPRoute annotations.
    extraArgs = ["--enable-gateway-api"]
  })]
}

# ClusterIssuers. ACME HTTP01 solver attaches to the public shared Gateway (alb-public-shared)
# so Let's Encrypt can reach the challenge endpoint from the internet.
# Tenants annotate HTTPRoutes (or Gateways) with cert-manager.io/cluster-issuer=letsencrypt-prod.
resource "kubectl_manifest" "issuer_staging" {
  yaml_body = yamlencode({
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata   = { name = "letsencrypt-staging" }
    spec = {
      acme = {
        email               = var.letsencrypt_email
        server              = "https://acme-staging-v02.api.letsencrypt.org/directory"
        privateKeySecretRef = { name = "letsencrypt-staging-account" }
        solvers = [{
          http01 = {
            gatewayHTTPRoute = {
              parentRefs = [{
                name      = "alb-public-shared"
                namespace = "gateway-system"
                kind      = "Gateway"
              }]
            }
          }
        }]
      }
    }
  })
  server_side_apply = true
  depends_on = [
    helm_release.cert_manager,
    kubectl_manifest.shared_gateway_public,
  ]
}

resource "kubectl_manifest" "issuer_prod" {
  yaml_body = yamlencode({
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata   = { name = "letsencrypt-prod" }
    spec = {
      acme = {
        email               = var.letsencrypt_email
        server              = "https://acme-v02.api.letsencrypt.org/directory"
        privateKeySecretRef = { name = "letsencrypt-prod-account" }
        solvers = [{
          http01 = {
            gatewayHTTPRoute = {
              parentRefs = [{
                name      = "alb-public-shared"
                namespace = "gateway-system"
                kind      = "Gateway"
              }]
            }
          }
        }]
      }
    }
  })
  server_side_apply = true
  depends_on = [
    helm_release.cert_manager,
    kubectl_manifest.shared_gateway_public,
  ]
}
