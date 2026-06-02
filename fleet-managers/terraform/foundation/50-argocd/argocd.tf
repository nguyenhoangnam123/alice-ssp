resource "kubernetes_namespace_v1" "argocd" {
  metadata {
    name = "argocd"
    labels = {
      # ssp.platform/tenant is the selector the shared Gateway's allowedRoutes uses;
      # without it, an HTTPRoute in this namespace cannot attach to the public ALB.
      "ssp.platform/tenant"     = "platform-shared"
      "ssp.platform/product"    = "ssp-platform"
      "ssp.platform/managed-by" = "ssp-foundation"
    }
  }
}

# HTTPRoute exposing the ArgoCD UI on the shared public ALB. The Gateway's `https` listener
# terminates TLS with the wildcard *.ssp.mightybee.dev cert; argocd-server runs with
# server.insecure=true so it speaks plain HTTP back from the target — no double-TLS dance.
resource "kubectl_manifest" "argocd_httproute" {
  yaml_body = yamlencode({
    apiVersion = "gateway.networking.k8s.io/v1"
    kind       = "HTTPRoute"
    metadata = {
      name      = "argocd-server"
      namespace = "argocd"
      labels = {
        "ssp.platform/tenant" = "platform-shared"
      }
      annotations = {
        "external-dns.alpha.kubernetes.io/hostname" = "argocd.ssp.mightybee.dev"
      }
    }
    spec = {
      parentRefs = [{
        name        = "alb-public-shared"
        namespace   = "gateway-system"
        sectionName = "https"
      }]
      hostnames = ["argocd.ssp.mightybee.dev"]
      rules = [{
        matches = [{
          path = { type = "PathPrefix", value = "/" }
        }]
        backendRefs = [{
          name = "argocd-server"
          port = 80
        }]
      }]
    }
  })
  server_side_apply = true
  depends_on        = [helm_release.argocd]
}

resource "helm_release" "argocd" {
  name       = "argocd"
  namespace  = kubernetes_namespace_v1.argocd.metadata[0].name
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = var.argocd_chart_version

  values = [yamlencode({
    global = {
      domain = ""  # set when wiring a public Gateway in front of ArgoCD
    }
    configs = merge(
      {
        params = {
          "server.insecure" = true  # behind ALB doing TLS termination
        }
      },
      var.argocd_admin_password_bcrypt != "" ? {
        secret = {
          argocdServerAdminPassword = var.argocd_admin_password_bcrypt
        }
      } : {},
    )
    server = {
      # No service.type LoadBalancer — exposed via a Gateway+HTTPRoute resource managed by the
      # bootstrap App-of-Apps in fleet-managers/argocd/.
      service = {
        type = "ClusterIP"
      }
    }
    controller = {
      replicas = 1
    }
    repoServer = {
      replicas = 2
    }
    applicationSet = {
      enabled  = true
      replicas = 1
    }
  })]
}
