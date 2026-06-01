# Two sets of CRDs are needed for the AWS LB Controller's Gateway API support:
#
#   1. Upstream Gateway API standard-channel CRDs (Gateway, HTTPRoute, GatewayClass,
#      ReferenceGrant). From sigs.k8s.io/gateway-api releases.
#
#   2. LBC-specific Gateway CRDs (LoadBalancerConfiguration, TargetGroupConfiguration,
#      ListenerRuleConfiguration). These live in the AWS LB Controller repo but are NOT
#      shipped in the Helm chart. Without them the controller logs:
#
#        "Disabling ALBGatewayAPI: missing required CRDs"
#
#      Source: kubernetes-sigs/aws-load-balancer-controller @ config/crd/gateway/gateway-crds.yaml

data "http" "gateway_api_crds" {
  url = "https://github.com/kubernetes-sigs/gateway-api/releases/download/${var.gateway_api_version}/standard-install.yaml"
}

data "kubectl_file_documents" "gateway_api_crds" {
  content = data.http.gateway_api_crds.response_body
}

resource "kubectl_manifest" "gateway_api_crds" {
  for_each          = data.kubectl_file_documents.gateway_api_crds.manifests
  yaml_body         = each.value
  server_side_apply = true
}

data "http" "lbc_gateway_crds" {
  url = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v${var.alb_controller_chart_version}/config/crd/gateway/gateway-crds.yaml"
}

data "kubectl_file_documents" "lbc_gateway_crds" {
  content = data.http.lbc_gateway_crds.response_body
}

resource "kubectl_manifest" "lbc_gateway_crds" {
  for_each          = data.kubectl_file_documents.lbc_gateway_crds.manifests
  yaml_body         = each.value
  server_side_apply = true
}
