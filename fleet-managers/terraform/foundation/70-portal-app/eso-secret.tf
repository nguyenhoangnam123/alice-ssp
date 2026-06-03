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

# GitHub PAT for Octokit — used by the AI workflow to open PRs against alice-ssp.
# Secret created manually via:
#   aws secretsmanager create-secret --name ssp/portal/github --kms-key-id alias/ssp-platform-secrets --secret-string '{"token":"<gh-token>"}'
resource "kubectl_manifest" "portal_github_external_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "portal-github"
      namespace = kubernetes_namespace_v1.portal.metadata[0].name
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "aws-secretsmanager"
        kind = "ClusterSecretStore"
      }
      target = {
        name           = "portal-github"
        creationPolicy = "Owner"
        template = {
          engineVersion = "v2"
          data = {
            GITHUB_TOKEN = "{{ .token }}"
          }
        }
      }
      dataFrom = [{
        extract = {
          key = "ssp/portal/github"
        }
      }]
    }
  })
  server_side_apply = true
  depends_on        = [kubernetes_namespace_v1.portal]
}

# Shared bearer token used by the MCP server running inside tenant pods to
# call the portal's /api/internal/{budget,llm-calls} endpoints. Symmetric
# secret for MVP1; Ring 2 swaps for short-lived per-tenant JWTs.
# Secret created manually via:
#   aws secretsmanager create-secret --name ssp/portal/internal-token \
#     --kms-key-id alias/ssp-platform-secrets \
#     --secret-string '{"token":"<32-byte hex>"}'
resource "kubectl_manifest" "portal_internal_token_external_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "portal-internal-token"
      namespace = kubernetes_namespace_v1.portal.metadata[0].name
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "aws-secretsmanager"
        kind = "ClusterSecretStore"
      }
      target = {
        name           = "portal-internal-token"
        creationPolicy = "Owner"
        template = {
          engineVersion = "v2"
          data = {
            SSP_INTERNAL_TOKEN = "{{ .token }}"
          }
        }
      }
      dataFrom = [{
        extract = {
          key = "ssp/portal/internal-token"
        }
      }]
    }
  })
  server_side_apply = true
  depends_on        = [kubernetes_namespace_v1.portal]
}

# Secret used by /api/webhooks/github to verify HMAC signatures on PR events.
resource "kubectl_manifest" "portal_github_webhook_external_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "portal-github-webhook"
      namespace = kubernetes_namespace_v1.portal.metadata[0].name
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "aws-secretsmanager"
        kind = "ClusterSecretStore"
      }
      target = {
        name           = "portal-github-webhook"
        creationPolicy = "Owner"
        template = {
          engineVersion = "v2"
          data = {
            SSP_GITHUB_WEBHOOK_SECRET = "{{ .secret }}"
          }
        }
      }
      dataFrom = [{
        extract = {
          key = "ssp/portal/github-webhook"
        }
      }]
    }
  })
  server_side_apply = true
  depends_on        = [kubernetes_namespace_v1.portal]
}
