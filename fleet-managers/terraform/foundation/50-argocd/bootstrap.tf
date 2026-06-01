# App-of-Apps root. After this applies, ArgoCD becomes self-managing — every change to
# argocd/applicationsets/, argocd/projects/, etc. flows in via git, not Terraform.
resource "kubectl_manifest" "root_app" {
  yaml_body = yamlencode({
    apiVersion = "argoproj.io/v1alpha1"
    kind       = "Application"
    metadata = {
      name      = "ssp-root"
      namespace = "argocd"
      labels = {
        "ssp.platform/managed-by" = "ssp-foundation"
      }
      finalizers = ["resources-finalizer.argocd.argoproj.io"]
    }
    spec = {
      project = "default"
      source = {
        repoURL        = var.fleet_repo_url
        targetRevision = var.fleet_repo_revision
        path           = "argocd"
        directory = {
          recurse = true
        }
      }
      destination = {
        server    = "https://kubernetes.default.svc"
        namespace = "argocd"
      }
      syncPolicy = {
        automated = {
          prune    = true
          selfHeal = true
        }
        syncOptions = ["CreateNamespace=true"]
      }
    }
  })
  depends_on = [helm_release.argocd]
}
