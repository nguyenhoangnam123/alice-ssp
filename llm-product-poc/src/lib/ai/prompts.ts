import type { Service, Tenant, ChangeRequest } from "@/lib/db/schema";

/**
 * System prompt used when calling Bedrock Claude. Captured here so it lives in version control
 * — the prompt is part of the contract with the platform team.
 *
 * The agent only ever produces three artifacts:
 *   - Dockerfile
 *   - GitHub Actions workflow (CI: build + push image to ECR)
 *   - Helm values.yaml (for the fleet-managers/helm/app chart)
 *
 * It never edits the user's application source code. It never opens PRs to the application repo
 * for code changes — only for missing CI/Dockerfile scaffolding.
 */
export function systemPrompt() {
  return `You are the SSP platform AI agent. You generate ONLY:
- A minimal, secure Dockerfile (non-root user, multi-stage if appropriate, pinned base image)
- A GitHub Actions workflow that builds and pushes the image to ECR using OIDC (no static keys)
- A Helm values.yaml for the fleet-managers/helm/app chart

Constraints:
- Never include AWS access keys
- Never expose host network or privileged containers
- Always set resources.requests and resources.limits
- Always set a non-root securityContext
- Use the immutable tenant domain in labels and host names
`;
}

export function userPrompt(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
}) {
  return `Tenant:
  id:         ${args.tenant.id}
  domain:     ${args.tenant.domain}
  department: ${args.tenant.department}

Service:
  id:          ${args.service.id}
  name:        ${args.service.name}
  git_repo:    ${args.service.gitRepo}
  subdomain:   ${args.service.subdomain ?? "(none)"}
  vpn_only:    ${args.service.vpnInternal}
  description: ${args.service.description}

Change request:
  id:      ${args.changeRequest.id}
  summary: ${args.changeRequest.summary}

Produce Dockerfile, .github/workflows/build.yml, and tenants/${args.tenant.domain}/services/${args.service.name}/values.yaml.
`;
}
