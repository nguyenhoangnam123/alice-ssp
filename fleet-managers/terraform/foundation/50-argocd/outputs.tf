output "argocd_namespace" {
  value = kubernetes_namespace_v1.argocd.metadata[0].name
}

output "argocd_release_name" {
  value = helm_release.argocd.name
}
