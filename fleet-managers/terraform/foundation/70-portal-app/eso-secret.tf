# SecretStore + ExternalSecret to sync the RDS master credentials from AWS Secrets Manager
# into a Kubernetes Secret in the portal namespace. Uses the cluster-wide ESO IRSA role
# provisioned by 40-platform-addons.
resource "kubectl_manifest" "portal_db_external_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "portal-db"
      namespace = kubernetes_namespace_v1.portal.metadata[0].name
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "aws-secretsmanager" # ClusterSecretStore from 40-platform-addons
        kind = "ClusterSecretStore"
      }
      target = {
        name = "portal-db"
        creationPolicy = "Owner"
        template = {
          engineVersion = "v2"
          # Emit a flat secret with the DATABASE_URL the portal consumes.
          data = {
            DATABASE_URL = "{{ .url }}"
            DB_HOST      = "{{ .host }}"
            DB_PORT      = "{{ .port }}"
            DB_USER      = "{{ .username }}"
            DB_PASSWORD  = "{{ .password }}"
            DB_NAME      = "{{ .database }}"
          }
        }
      }
      dataFrom = [{
        extract = {
          key = local.db_secret_name
        }
      }]
    }
  })
  server_side_apply = true
  depends_on        = [kubernetes_namespace_v1.portal]
}
