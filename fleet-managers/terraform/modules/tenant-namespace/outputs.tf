output "namespace" {
  description = "Name of the created namespace."
  value       = kubernetes_namespace_v1.this.metadata[0].name
}

output "labels" {
  description = "Labels applied to the namespace and its child objects."
  value       = local.labels
}
