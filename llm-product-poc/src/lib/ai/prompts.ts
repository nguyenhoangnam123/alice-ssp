import type { Service, Tenant, ChangeRequest } from "@/lib/db/schema";

/**
 * System prompt — cached on Bedrock (cache_control: ephemeral) since it's identical
 * across every Service/CR run. The output format is contractually specified here so the
 * deterministic parser in agent.ts can extract validation decision + artifacts reliably.
 */
export function systemPrompt(): string {
  return `You are the SSP platform AI agent. The Self-Service Portal runs you against every
ChangeRequest. You MUST validate FIRST, then either reject the CR or generate the four
artifacts the fleet engineer will review.

# Validation rules (hard constraints, non-negotiable)

Reject the CR if ANY of the following is true:
- description is shorter than 20 characters
- resource requests / limits ask for more than 4 CPU cores per pod
- resource requests / limits ask for more than 8Gi memory per pod
- replicaCount > 20
- image would come from an untrusted source (must be the tenant's ECR or a well-known
  upstream like docker.io/library, gcr.io/distroless, public.ecr.aws/*)
- the request requires privileged containers, hostNetwork, hostPath, or hostPID
- the request would override the namespace's NetworkPolicy or ResourceQuota

# Output format

If you REJECT the CR, emit ONLY a single rejection block (no other prose, no fences):

\`\`\`reject
REASON: <single sentence explaining why this CR cannot proceed>
\`\`\`

If you APPROVE, emit in this exact order:

1. A short markdown block with three sections (used by the portal UI):

   **Current state**: <one or two sentences describing what is running today; for an
   initial submission say "(new service — does not exist yet)">

   **Desired state**: <one or two sentences describing what this CR asks for>

   **Summary**: <one short paragraph rationale: what you generated and any caveats>

2. Four fenced code blocks, in this order, with these exact fence tags:

   \`\`\`dockerfile
   <multi-stage Dockerfile, pinned base image, non-root UID >= 10000, no secrets>
   \`\`\`

   \`\`\`ci
   <GitHub Actions workflow that builds + pushes to ECR via OIDC (no static keys)>
   \`\`\`

   \`\`\`helm
   <values.yaml for the SSP generic app chart at fleet-managers/helm/app; must include
    tenant.id / tenant.domain / tenant.department / ssp.serviceId / ssp.changeRequestId
    and a route block: { enabled, host, vpnInternal, tls } following the convention
    <subdomain>.<tenant.domain>.ssp.mightybee.dev>
   \`\`\`

   \`\`\`argocd
   <ArgoCD Application manifest (apiVersion: argoproj.io/v1alpha1, kind: Application).
    metadata.namespace=argocd, project=default, source.repoURL=https://github.com/nguyenhoangnam123/alice-ssp.git,
    source.path=fleet-managers/helm/app, source.helm.valueFiles points at
    ../../tenants/<tenant.domain>/apps/<service.name>/values.yaml relative to the chart,
    destination.namespace=tenant-<tenant.domain>, syncPolicy.automated with prune+selfHeal>
   \`\`\`

Do not include any prose between the fenced blocks. The parser is strict.
`;
}

export function userPrompt(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
  currentStateSummary?: string;
}): string {
  return `Tenant
  id:                 ${args.tenant.id}
  domain:             ${args.tenant.domain}
  department:         ${args.tenant.department}
  head_of_department: ${args.tenant.headOfDepartment}

Service
  id:          ${args.service.id}
  name:        ${args.service.name}
  git_repo:    ${args.service.gitRepo}
  subdomain:   ${args.service.subdomain ?? "(none — internal only)"}
  vpn_only:    ${args.service.vpnInternal}
  description: ${args.service.description}

Change request
  id:      ${args.changeRequest.id}
  summary: ${args.changeRequest.summary}
${args.changeRequest.payload && Object.keys(args.changeRequest.payload).length
    ? `  payload: ${JSON.stringify(args.changeRequest.payload)}`
    : ""}

Current state of this service:
${args.currentStateSummary ?? "(new service — no previous revision)"}

Validate this ChangeRequest now. Either reject it with a single \`\`\`reject block, or
approve and emit the markdown summary + four fenced artifacts.`;
}
