# LoadBalancerConfiguration CRs configure the ALB the LBC provisions for each
# GatewayClass — scheme (internal vs internet-facing) and default cert for HTTPS:443.

data "terraform_remote_state" "dns" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket_name
    key     = "foundation/15-dns/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

locals {
  portal_cert_arn = data.terraform_remote_state.dns.outputs.portal_certificate_arn
}

# Default target group config — IP targets. Pod IPs become ALB targets directly, skipping
# the NodePort hop and kube-proxy LB layer. Lower latency + per-pod observability.
resource "kubectl_manifest" "tgc_ip_default" {
  yaml_body = yamlencode({
    apiVersion = "gateway.k8s.aws/v1beta1"
    kind       = "TargetGroupConfiguration"
    metadata = {
      name      = "ip-targets-default"
      namespace = "kube-system"
    }
    spec = {
      defaultConfiguration = {
        targetType = "ip"
      }
    }
  })
  server_side_apply = true
  depends_on        = [kubectl_manifest.lbc_gateway_crds]
}

# Public ALB — terminates TLS with the ACM cert provisioned in 15-dns, IP target type.
resource "kubectl_manifest" "lbconfig_public" {
  yaml_body = yamlencode({
    apiVersion = "gateway.k8s.aws/v1beta1"
    kind       = "LoadBalancerConfiguration"
    metadata = {
      name      = "alb-public"
      namespace = "kube-system"
    }
    spec = {
      scheme = "internet-facing"
      defaultTargetGroupConfiguration = {
        name = "ip-targets-default"
      }
      listenerConfigurations = [
        {
          protocolPort       = "HTTPS:443"
          defaultCertificate = local.portal_cert_arn
        },
        {
          protocolPort = "HTTP:80"
        },
      ]
    }
  })
  server_side_apply = true
  depends_on = [
    kubectl_manifest.lbc_gateway_crds,
    kubectl_manifest.tgc_ip_default,
  ]
}

# Internal ALB — IP targets, internal scheme. Kept for VPN-only services later.
resource "kubectl_manifest" "lbconfig_internal" {
  yaml_body = yamlencode({
    apiVersion = "gateway.k8s.aws/v1beta1"
    kind       = "LoadBalancerConfiguration"
    metadata = {
      name      = "alb-internal"
      namespace = "kube-system"
    }
    spec = {
      scheme = "internal"
      defaultTargetGroupConfiguration = {
        name = "ip-targets-default"
      }
    }
  })
  server_side_apply = true
  depends_on = [
    kubectl_manifest.lbc_gateway_crds,
    kubectl_manifest.tgc_ip_default,
  ]
}

# Empty K8s Secret used as the Gateway HTTPS listener's tls.certificateRefs placeholder —
# Gateway API spec requires non-empty certificateRefs when mode=Terminate, but the actual
# cert comes from the LBConfig's defaultCertificate. The LBC uses LBConfig over this.
resource "kubernetes_secret_v1" "gateway_tls_placeholder" {
  metadata {
    name      = "gateway-tls-placeholder"
    namespace = kubernetes_namespace_v1.gateway_system.metadata[0].name
  }
  type = "kubernetes.io/tls"
  data = {
    "tls.crt" = ""
    "tls.key" = ""
  }
}
