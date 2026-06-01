# Metrics Server — mandatory for HPA, `kubectl top`, and the Kubernetes Dashboard.
# Single replica is fine for MVP1; bump to 2 with PodDisruptionBudget for prod.
resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  namespace  = "kube-system"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = var.metrics_server_chart_version

  values = [yamlencode({
    replicas = 1
    args = [
      "--kubelet-insecure-tls",  # MVP1: avoids kubelet TLS bootstrap dance
      "--kubelet-preferred-address-types=InternalIP",
    ]
  })]
}
