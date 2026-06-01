# IRSA role for the AWS Load Balancer Controller. The official IAM policy JSON is fetched
# from the upstream release so we don't drift on permission updates.
data "http" "alb_controller_iam_policy" {
  url = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${var.alb_controller_iam_policy_ref}/docs/install/iam_policy.json"
}

resource "aws_iam_policy" "alb_controller" {
  name        = "${local.cluster_name}-aws-load-balancer-controller"
  description = "IAM policy for the AWS Load Balancer Controller"
  policy      = data.http.alb_controller_iam_policy.response_body
}

data "aws_iam_policy_document" "alb_controller_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "${local.cluster_name}-aws-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_trust.json
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.alb_controller_chart_version

  values = [yamlencode({
    clusterName = local.cluster_name
    region      = var.aws_region
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
      annotations = {
        "eks.amazonaws.com/role-arn" = aws_iam_role.alb_controller.arn
      }
    }
    # Chart v3.x: Gateway API is wired up via controllerConfig.featureGates.
    # ALBGatewayAPI=true starts the Gateway/HTTPRoute reconcilers that watch
    # GatewayClass controllerName=gateway.k8s.aws/alb.
    controllerConfig = {
      featureGates = {
        ALBGatewayAPI = true
      }
    }
  })]

  depends_on = [kubectl_manifest.gateway_api_crds]
}

# Two GatewayClasses — internal vs public. Distinguished at the Gateway level via the
# alb.ingress.kubernetes.io/scheme annotation (set on the shared Gateways in
# shared-gateways.tf). Avoids the parametersRef / LoadBalancerConfiguration mechanism,
# which has churned across LBC releases.
resource "kubectl_manifest" "gatewayclass_alb_internal" {
  yaml_body = yamlencode({
    apiVersion = "gateway.networking.k8s.io/v1"
    kind       = "GatewayClass"
    metadata = {
      name = "alb-internal"
    }
    spec = {
      controllerName = "gateway.k8s.aws/alb"
    }
  })
  server_side_apply = true
  depends_on        = [helm_release.aws_load_balancer_controller]
}

resource "kubectl_manifest" "gatewayclass_alb_public" {
  yaml_body = yamlencode({
    apiVersion = "gateway.networking.k8s.io/v1"
    kind       = "GatewayClass"
    metadata = {
      name = "alb-public"
    }
    spec = {
      controllerName = "gateway.k8s.aws/alb"
    }
  })
  server_side_apply = true
  depends_on        = [helm_release.aws_load_balancer_controller]
}
