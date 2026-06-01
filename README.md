# SSP — Self-Service Portal

Bridge between vibe-coding users and platform engineers. Two repos:

| Repo | Owns | Role |
| --- | --- | --- |
| [`llm-product-poc/`](./llm-product-poc) | Platform team | Portal UI + API + workflow + AI agent. Opens PRs against `fleet-managers`. |
| [`fleet-managers/`](./fleet-managers) | Platform team | GitOps source of truth. Terraform (per-tenant ns + IAM), Helm app chart, ArgoCD ApplicationSet. ArgoCD reconciles into EKS. |

DevOps owns the EKS cluster, ArgoCD install, ingress, Cognito pool, and account guardrails — these are *inputs* to both repos, not part of either.

See [docs/architecture.md](./docs/architecture.md) for the full architecture, sequence flow, data model, status lifecycle, and multi-tenancy boundary.

## MVP1 scope

- Skeleton + working portal with **mocked** AWS integrations.
- Real Cognito / Bedrock / Step Functions deferred to MVP2 (interfaces are already in place — flip `AUTH_MODE`, `AI_MODE`, `WORKFLOW_MODE`).
- Tenant onboarding workflow runs end-to-end locally: create tenant → submit service → mock AI agent generates Dockerfile + Helm values → "PR" body printed to stdout → simulate merge → status moves to `working`.

## Quick start

```bash
# Portal
cd llm-product-poc
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev   # http://localhost:3000

# Fleet repo (read-only artifact for MVP1)
cd ../fleet-managers
# Inspect terraform/, helm/, argocd/, tenants/
```

## Layout

```
alice/
  llm-product-poc/         # SSP portal (Next.js 15, Drizzle, Postgres)
  fleet-managers/          # GitOps repo (Terraform + Helm + ArgoCD)
  docs/
    architecture.md        # mermaid diagrams (system, workflow, data model, status, EKS)
```

## CI

Both repos have GitHub Actions:

- `llm-product-poc/.github/workflows/ci.yml` — lint, typecheck, build, migrations drift check
- `llm-product-poc/.github/workflows/codeql.yml` — security analysis
- `fleet-managers/.github/workflows/terraform.yml` — fmt, validate, tflint
- `fleet-managers/.github/workflows/helm.yml` — lint, template, kubeconform
- `fleet-managers/.github/workflows/argocd-validate.yml` — kubeconform on AppProject/ApplicationSet

## Glossary

- **Tenant**: an internal department. Has an immutable `domain`, tags (propagated to AWS for cost attribution), and members.
- **Service**: an application that runs in the tenant's namespace.
- **ChangeRequest** (CR): the mutable unit of work — any update to a Service goes through one.
- **ServiceRevision**: append-only audit snapshot capturing the state of CI/Dockerfile/CD manifests at each transition.
