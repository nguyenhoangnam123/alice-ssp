import type { Service, Tenant, ChangeRequest } from "@/lib/db/schema";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { systemPrompt, userPrompt } from "./prompts";

export type Artifacts = {
  dockerfile: string;
  ciWorkflow: string;
  helmValues: string;
  argocdApp: string;
  ciPipelineRef: string;
  summary: string;
};

export type AgentResult =
  | { kind: "approved"; artifacts: Artifacts }
  | { kind: "rejected"; reason: string; rawSummary: string };

/**
 * Validate the CR and (if approved) generate the four artifacts.
 *
 * AI_MODE=mock    — deterministic templates, never rejects (used in CI / offline dev).
 * AI_MODE=bedrock — Claude on Bedrock with prompt caching on the system prompt.
 */
export async function generateArtifacts(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
  currentStateSummary?: string;
}): Promise<AgentResult> {
  const mode = process.env.AI_MODE ?? "mock";

  if (mode === "bedrock") {
    return bedrockArtifacts(args);
  }
  if (mode === "mock") {
    return mockArtifacts(args);
  }
  throw new Error(`unknown AI_MODE: ${mode}`);
}

// ---------------------------------------------------------------------------
// Bedrock — real Claude inference
// ---------------------------------------------------------------------------

let cachedClient: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION ?? "eu-west-1",
    });
  }
  return cachedClient;
}

async function bedrockArtifacts(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
  currentStateSummary?: string;
}): Promise<AgentResult> {
  const modelId =
    process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-opus-4-6-v1";

  const sys = systemPrompt();
  const usr = userPrompt(args);

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: sys,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: usr }],
      },
    ],
  };

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const start = Date.now();
  const res = await client().send(cmd);
  const elapsed = Date.now() - start;

  const decoded = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(decoded) as {
    content: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };

  const text = parsed.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  console.log(
    `bedrock ok model=${modelId} ms=${elapsed} tok_in=${parsed.usage?.input_tokens ?? "?"} tok_out=${parsed.usage?.output_tokens ?? "?"} cache_read=${parsed.usage?.cache_read_input_tokens ?? 0}`,
  );

  // Rejection short-circuit. The system prompt instructs Claude to emit ONLY a
  // ```reject block when the CR violates a constraint.
  const rejectMatch = text.match(/```reject\s*\n([\s\S]*?)\n```/i);
  if (rejectMatch) {
    const reasonMatch = rejectMatch[1].match(/REASON:\s*(.+)/i);
    const reason = (reasonMatch?.[1] ?? rejectMatch[1]).trim();
    return {
      kind: "rejected",
      reason,
      rawSummary: `**Rejected by AI**: ${reason}`,
    };
  }

  const extracted = extractArtifacts(text);
  return {
    kind: "approved",
    artifacts: {
      dockerfile: extracted.dockerfile,
      ciWorkflow: extracted.ci_workflow,
      helmValues: extracted.helm_values,
      argocdApp: extracted.argocd_app,
      ciPipelineRef: `${args.service.gitRepo}/.github/workflows/build.yml`,
      summary: extracted.summary,
    },
  };
}

function extractArtifacts(text: string): {
  dockerfile: string;
  ci_workflow: string;
  helm_values: string;
  argocd_app: string;
  summary: string;
} {
  const block = (tag: string): string => {
    const re = new RegExp("```" + tag + "\\s*\\n([\\s\\S]*?)\\n```", "i");
    return text.match(re)?.[1]?.trim() ?? "";
  };

  // Summary = everything before the first fence.
  const firstFenceIdx = text.indexOf("```");
  const summary =
    firstFenceIdx > 0 ? text.slice(0, firstFenceIdx).trim() : "(no summary)";

  return {
    dockerfile: block("dockerfile") || block("Dockerfile"),
    ci_workflow: block("ci") || block("yaml") || block("yml"),
    helm_values: block("helm") || block("values"),
    argocd_app: block("argocd") || block("Application"),
    summary,
  };
}

// ---------------------------------------------------------------------------
// Mock — deterministic templates for offline dev / CI
// ---------------------------------------------------------------------------

function mockArtifacts(args: {
  service: Service;
  tenant: Tenant;
  changeRequest: ChangeRequest;
}): AgentResult {
  const { service, tenant } = args;
  const slug = service.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const dockerfile = `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN addgroup -g 10000 app && adduser -u 10000 -G app -D app
WORKDIR /app
COPY --from=build --chown=10000:10000 /app /app
USER 10000
EXPOSE 8080
CMD ["node", "dist/index.js"]
`;
  const ciWorkflow = `name: build-and-push
on: { push: { branches: [main] } }
permissions: { id-token: write, contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.ECR_PUSH_ROLE_ARN }}
          aws-region: eu-west-1
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - run: docker build -t \${{ steps.ecr.outputs.registry }}/${slug}:\${{ github.sha }} . && docker push \${{ steps.ecr.outputs.registry }}/${slug}:\${{ github.sha }}
`;
  const helmValues = `image:
  repository: 195748744911.dkr.ecr.eu-west-1.amazonaws.com/${slug}
  tag: latest
service: { port: 8080 }
route:
  enabled: ${Boolean(service.subdomain)}
  host: "${(service.subdomain ?? service.name).includes(".") ? (service.subdomain ?? service.name) : `${service.subdomain ?? service.name}.ssp.mightybee.dev`}"
  vpnInternal: ${service.vpnInternal}
  tls: ${!service.vpnInternal}
tenant: { id: "${tenant.id}", domain: "${tenant.domain}", department: "${tenant.department}" }
ssp: { serviceId: "${service.id}", changeRequestId: "${args.changeRequest.id}" }
`;
  const argocdApp = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${tenant.domain}-${slug}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/nguyenhoangnam123/alice-ssp.git
    targetRevision: main
    path: fleet-managers/helm/app
    helm:
      valueFiles: ["../../tenants/${tenant.domain}/apps/${slug}/values.yaml"]
  destination:
    server: https://kubernetes.default.svc
    namespace: tenant-${tenant.domain}
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
`;
  return {
    kind: "approved",
    artifacts: {
      dockerfile,
      ciWorkflow,
      helmValues,
      argocdApp,
      ciPipelineRef: `${service.gitRepo}/.github/workflows/build.yml`,
      summary: `**Current state**: (new service — does not exist yet)\n\n**Desired state**: Helm app + ArgoCD Application for ${tenant.domain}/${service.name}.\n\n**Summary**: Mock generation; production path goes through Bedrock Opus 4.6.`,
    },
  };
}
