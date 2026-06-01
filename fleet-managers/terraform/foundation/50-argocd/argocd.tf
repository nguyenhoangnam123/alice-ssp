resource "kubernetes_namespace_v1" "argocd" {
  metadata {
    name = "argocd"
    labels = {
      "ssp.platform/managed-by" = "ssp-foundation"
    }
  }
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
