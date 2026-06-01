# Portal deployment is OWNED BY ARGOCD via the Application manifest at
# fleet-managers/argocd/apps/ssp-portal.yaml. This Terraform layer only manages:
#   - the ssp-portal namespace + labels (so the shared Gateway / OpenCost can attach)
#   - the ExternalSecret syncing RDS creds from AWS Secrets Manager
#
# The Helm release is intentionally NOT defined here — that's ArgoCD's job. See ADR 0001
# (fleet-repo pattern) for why we don't write to the cluster directly.
