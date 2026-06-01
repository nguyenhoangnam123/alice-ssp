# Portal Helm release. Uses the generic app chart from fleet-managers/helm/app, configured
# with the portal-specific image, Ingress, and env vars sourced from the ExternalSecret.
#
# MVP1 deploys via the Terraform helm provider for speed. MVP2 moves this to an ArgoCD
# Application so the GitOps loop owns the portal too.
resource "helm_release" "portal" {
  name      = "ssp-portal"
  namespace = kubernetes_namespace_v1.portal.metadata[0].name
  chart     = "${path.module}/../../../helm/app"

  values = [yamlencode({
    image = {
      repository = local.portal_repo_url
      tag        = var.image_tag
      pullPolicy = "IfNotPresent"
    }
    replicaCount = var.replicas
    service = {
      port = 3000
      type = "ClusterIP"
    }
    ingress = {
      enabled     = true
      className   = "alb"
      host        = var.hostname
      vpnInternal = false
      annotations = {
        "external-dns.alpha.kubernetes.io/hostname" = var.hostname
        # alb.ingress.kubernetes.io/group.name allows multiple Ingresses to share an ALB;
        # only useful once we have >1 Ingress.
        "alb.ingress.kubernetes.io/group.name"      = "ssp-public"
      }
      tls = {
        enabled = false # MVP1: HTTP only. Flip to true after the public ALB + cert-manager paths are verified.
        issuer  = "letsencrypt-prod"
      }
    }
    resources = {
      requests = { cpu = "200m", memory = "512Mi" }
      limits   = { cpu = "1000m", memory = "1Gi" }
    }
    serviceAccount = {
      create      = true
      annotations = {}
    }
    tenant = {
      id          = "ssp-portal"
      domain      = "ssp-portal"
      department  = "platform"
      costCenter  = "platform-eng"
      product     = "ssp-portal"
      environment = "shared-prod"
    }
    ssp = {
      serviceId       = "platform-portal"
      changeRequestId = ""
      revisionId      = "tf-${var.image_tag}"
    }
    # Extra envFrom + initContainer overrides are managed by patch resources below since the
    # generic chart doesn't template them yet.
  })]

  depends_on = [
    kubernetes_namespace_v1.portal,
    kubectl_manifest.portal_db_external_secret,
  ]
}

# Patch the Deployment to:
#   1. Wire DATABASE_URL + Cognito settings from the synced K8s Secret + literals.
#   2. Add a one-shot init container that runs `npm run db:migrate` before the portal starts.
resource "kubectl_manifest" "portal_env_patch" {
  yaml_body = yamlencode({
    apiVersion = "apps/v1"
    kind       = "Deployment"
    metadata = {
      name      = "ssp-portal-app"
      namespace = kubernetes_namespace_v1.portal.metadata[0].name
    }
    spec = {
      template = {
        spec = {
          initContainers = [{
            name            = "migrate"
            image           = "${local.portal_repo_url}:${var.image_tag}"
            imagePullPolicy = "IfNotPresent"
            command         = ["node", "--import=tsx", "src/lib/db/migrate.ts"]
            envFrom = [{
              secretRef = { name = "portal-db" }
            }]
          }]
          containers = [{
            name = "app"
            envFrom = [{
              secretRef = { name = "portal-db" }
            }]
            env = [
              { name = "AUTH_MODE", value = "stub" },
              { name = "AI_MODE", value = "mock" },
              { name = "WORKFLOW_MODE", value = "in-process" },
              { name = "COGNITO_REGION", value = var.aws_region },
              { name = "COGNITO_USER_POOL_ID", value = local.cognito_pool_id },
              { name = "COGNITO_CLIENT_ID", value = local.cognito_client_id },
              { name = "FLEET_REPO_OWNER", value = "nguyenhoangnam123" },
              { name = "FLEET_REPO_NAME", value = "alice-ssp" },
            ]
          }]
        }
      }
    }
  })
  server_side_apply = true
  force_conflicts   = true
  depends_on        = [helm_release.portal]
}
