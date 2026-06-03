# SSP — Self-Service Portal

A platform that lets product engineers ship a service to production without learning
Kubernetes, IAM, or Terraform — while giving the platform team a single, auditable
review surface and the cost team clean per-tenant attribution.

| Live | URL / value |
| --- | --- |
| Portal | https://portal.ssp.mightybee.dev |
| GitOps repo | https://github.com/nguyenhoangnam123/alice-ssp |
| Cluster | `ssp-shared` (EKS 1.30, eu-west-1, account `195748744911`) |
| Database | RDS Postgres 16.14, single-AZ private subnets, SSL enforced |
| Auth | Cognito user pool `eu-west-1_zEVRIg5JY` |
| LLM | Bedrock Claude Opus 4.6 via the EU cross-region inference profile |
| Idle cost | ~$165–200/mo (EKS + NAT + RDS + 3 ALBs + ECR + R53) |

## Documentation map

**Product / requirements track**

| File | Read when |
| --- | --- |
| [01-user-stories.md](./01-user-stories.md) | You want to know who the portal is for and what each persona needs. Five personas, 17 stories. |
| [02-use-cases.md](./02-use-cases.md) | You want feature-by-feature breakdown with sequence diagrams. Each use case links to the user stories it closes. |
| [03-qualification.md](./03-qualification.md) | You want an honest read of where the platform is strong (automation, security) and where the gaps are (HA, image scanning, idle cleanup). Done vs not-yet for each quality. |
| [04-system-design.md](./04-system-design.md) | You want the AWS + GitHub topology, Terraform module layout, tag schema, and end-to-end CR sequence in one place. |

**Engineering deep-dive**

| File | Read when |
| --- | --- |
| [architecture.md](./architecture.md) | You want to know what runs where and who owns it. Five Mermaid diagrams. |
| [guardrails.md](./guardrails.md) | You want to see how unsafe asks get caught. Six layers from Zod at the API edge to NetworkPolicy at the pod. |
| [cost-and-observability.md](./cost-and-observability.md) | You want to see who pays for what and how we know what's happening. |
| [e2e-evidence.md](./e2e-evidence.md) | You want the receipts — actual ChangeRequest outputs from the live portal. |

## Pitch in two paragraphs

A product engineer opens the portal, describes their service in a paragraph
(*"a small Node API for our growth experiments, public, two replicas"*), and clicks
submit. Within ~20 seconds the AI agent (Claude Opus 4.6 on Bedrock) has either rejected
the request with a specific reason ("requested 16 CPU per pod exceeds the 4-core cap")
or opened a four-file pull request against the `fleet-managers` GitOps repo: Dockerfile,
GitHub Actions workflow, Helm values, and an ArgoCD `Application` manifest. The platform
engineer merges, ArgoCD reconciles, and a public ALB serves the service at
`<subdomain>.<tenant>.ssp.mightybee.dev` behind a WAF and a real TLS cert.

What the AI doesn't catch — and there's plenty: namespaces, IAM roles, NetworkPolicy,
secret scoping, cost tags — is enforced *out of band* by Terraform-provisioned platform
machinery so the AI's worst behaviour can't break tenant isolation. The result is a
loop where the AI handles the boring 90% (boilerplate generation, obvious-bad-input
rejection), the platform engineer reviews the interesting 10%, and the customer never
has to learn what an `IngressClass` is.

## Quick start

```bash
# 1. Look at the portal
open https://portal.ssp.mightybee.dev

# 2. Look at a recent PR opened by the AI
open https://github.com/nguyenhoangnam123/alice-ssp/pull/6

# 3. Tail the AI agent live
KUBECONFIG=~/Documents/alice/.kubeconfig kubectl -n ssp-portal logs -f -l app.kubernetes.io/name=app
```

For the engineering deep-dive, start with [architecture.md](./architecture.md).
