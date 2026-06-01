import type { Service, Tenant, ChangeRequest } from "@/lib/db/schema";

/**
 * System prompt — cached on Bedrock (cache_control: ephemeral) since it's identical
 * across every Service/CR run. The output format is contractually specified here so the
 * deterministic parser in agent.ts can extract three artifacts reliably.
 */
export function systemPrompt(): string {
  return `You are the SSP platform AI agent. The Self-Service Portal runs you against
every new Service or ChangeRequest. Your job is to produce three artifacts that the
platform engineering team will review before merging:

1. A Dockerfile — multi-stage, non-root user, pinned base image (no :latest), no secrets
2. A GitHub Actions workflow that builds and pushes the image to ECR using OIDC
   (assumes a role; never uses static AWS keys)
3. A Helm values.yaml for the SSP generic app chart (fleet-managers/helm/app)

Hard constraints — non-negotiable:
- Container runs as non-root (UID >= 10000)
- No \`docker run --privileged\`, no \`hostNetwork: true\`, no \`hostPath\` mounts
- resources.requests AND resources.limits set for both CPU and memory
- Exact base image digest is preferred but a pinned tag is acceptable
- The Helm values must include tenant.id / tenant.domain / tenant.department from the
  tenant data given in the prompt, and ssp.serviceId / ssp.changeRequestId
- Route hostname pattern: <subdomain>.<tenant.domain>.ssp.mightybee.dev

Output format — strict. Respond with:
  1. A 1-2 sentence summary explaining what you generated and any caveats.
  2. The Dockerfile inside a \`\`\`dockerfile fenced block.
  3. The GitHub Actions workflow inside a \`\`\`ci fenced block.
  4. The Helm values inside a \`\`\`helm fenced block.

Do not include any other prose between the blocks. The parser uses these exact fence tags.
`;
}

export function userPrompt(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
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

Produce the three artifacts now.`;
}
