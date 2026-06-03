# 04 — Platform system design

Top-to-bottom view of what runs where, on which cloud surface, and how the two
external platforms (AWS, GitHub) compose. For deeper architectural rationale (why
Gateway API not Ingress, why ip-targets not instance-mode, etc.) see
[`architecture.md`](./architecture.md).

## High-level

```mermaid
flowchart LR
  user((User)) -->|HTTPS| R53[Route53<br/>ssp.mightybee.dev]
  R53 --> ALB[ALB<br/>public, ACM wildcard]
  ALB --> WAF[WAFv2<br/>managed + custom]
  WAF --> GW[Gateway API<br/>HTTPRoute per tenant]
  GW --> NSA[ns: ssp-portal<br/>portal app]
  GW --> NSB[ns: tenant-alice<br/>tenant workloads]

  subgraph GitHub["GitHub — single repo: nguyenhoangnam123/alice-ssp"]
    direction TB
    GHA[GH Actions<br/>build-portal, ci-portal]
    PR[Pull requests<br/>AI-generated]
    Main[main branch<br/>fleet source of truth]
    Hook[/api/webhooks/github/]
  end

  NSA -->|opens PR| PR
  PR --> Main
  Main -->|Argo polls| Argo[ArgoCD<br/>app-of-apps]
  Argo --> NSA
  Argo --> NSB
  GHA -->|OIDC| ECR
  PR --> Hook
  Hook --> NSA

  classDef aws fill:#FF9900,stroke:#232F3E,color:#232F3E;
  classDef gh fill:#24292F,stroke:#000,color:#FFFFFF;
  class R53,ALB,WAF,GW,NSA,NSB,Argo,ECR aws;
  class GHA,PR,Main,Hook gh;
```

---

## AWS topology

```mermaid
flowchart TB
  subgraph AWS["AWS account 195748744911 / eu-west-1"]
    direction TB

    subgraph Edge["Edge"]
      R53[Route53 zone<br/>ssp.mightybee.dev<br/>delegated NS]
      ACM[ACM wildcard<br/>*.ssp.mightybee.dev]
      WAF[WAFv2 Web ACL<br/>managed common +<br/>AllowWebhook +<br/>AllowArgoCDHost]
      ALB[Application LB<br/>public, IP targets]
    end

    subgraph Compute["VPC eu-west-1 (private + public subnets)"]
      EKS[EKS cluster ssp-shared<br/>managed node group,<br/>Pod Identity + IRSA]
      subgraph Addons["Platform addons"]
        LBC[AWS Load Balancer<br/>Controller v3.3]
        ESO[External Secrets<br/>Operator]
        XDNS[ExternalDNS]
        ArgoCD[ArgoCD App-of-Apps]
      end
      EKS --> Addons
    end

    subgraph Data["Data"]
      RDS[RDS Postgres 16.14<br/>portal DB]
      Cog[Cognito User Pool]
      ECR[ECR private<br/>ssp-portal + per-service]
      SM[Secrets Manager<br/>+ KMS]
    end

    subgraph AI["AI"]
      Bedrock[Bedrock<br/>Claude Opus 4.6<br/>EU cross-region profile]
    end

    subgraph Gov["Governance"]
      Budgets[AWS Budgets<br/>per cost_center<br/>+ overall]
      CE[Cost Explorer<br/>tag aggregation]
      CW[CloudWatch Logs<br/>1-day retention]
    end

    R53 --> ALB
    ACM --> ALB
    WAF --> ALB
    ALB --> EKS
    EKS --> RDS
    EKS --> Cog
    EKS --> SM
    EKS --> Bedrock
    EKS --> ECR
    SM --> ESO
    Budgets --> CE
    EKS -. logs .-> CW
  end

  classDef done fill:#1e7f3e,stroke:#0c3,color:#fff;
  class R53,ACM,WAF,ALB,EKS,LBC,ESO,XDNS,ArgoCD,RDS,Cog,ECR,SM,Bedrock,Budgets,CW done;
```

### Terraform module layout

```
fleet-managers/terraform/foundation/
├── 00-bootstrap/        # state backend (S3+DDB), KMS keys
├── 10-vpc/              # VPC, subnets, NAT, flow-log defaults
├── 15-dns/              # Route53 zone + ACM wildcard cert
├── 20-eks/              # EKS cluster, managed node group, CW retention 1d
├── 30-cognito/          # User Pool + app client
├── 40-platform-addons/  # LBC, ESO, ExternalDNS, ArgoCD (Helm via Terraform)
├── 45-waf/              # WAFv2 Web ACL + ALB association + log group 1d
├── 50-argocd/           # ArgoCD app-of-apps Application
├── 55-ecr/              # ECR repos + GitHub OIDC trust policy
├── 60-portal-data/      # RDS + parameter group + db credentials secret
├── 70-portal-app/       # Portal namespace, IRSA, ExternalSecrets for portal env
├── 80-cost-governance/  # AWS Budgets per cost_center + account overall
└── tenants/<name>/      # Per-tenant namespace, NetworkPolicy, ResourceQuota, IRSA
```

Each module has its own backend state key. Numbering is execution order — `00`
bootstraps the backend; everything else depends on it transitively.

### Tag schema

| Key | Example | Purpose |
| --- | --- | --- |
| `tenant` | `alice`, `platform-shared` | Per-tenant chargeback |
| `product` | `hr-portal`, `ssp-platform` | Per-product cost view |
| `environment` | `shared-prod` | Multi-env when relevant |
| `cost_center` | `alice`, `platform-eng` | Department chargeback (drives Budget filters) |
| `managed_by` | `terraform` | Distinguish IaC vs. click-ops |
| `owner` | `devops` | Escalation target |

Applied via Terraform `default_tags` in every provider block — every resource the
foundation creates carries all six.

---

## GitHub topology

```mermaid
flowchart TB
  subgraph Repo["Repo: nguyenhoangnam123/alice-ssp (single repo, two top-level dirs)"]
    direction TB
    LP["llm-product-poc/<br/>Next.js portal source"]
    FM["fleet-managers/<br/>Terraform + Helm + ArgoCD"]
  end

  subgraph CI["GitHub Actions workflows"]
    BP[".github/workflows/<br/>build-portal.yml<br/>(builds + pushes to ECR<br/>on llm-product-poc/ changes)"]
    CP[".github/workflows/<br/>ci-portal.yml<br/>(lint + typecheck<br/>on PRs)"]
    CQ[".github/workflows/<br/>codeql.yml<br/>(security scan)"]
  end

  subgraph GitOps["fleet-managers/ — source of truth"]
    AOA["argocd/apps/<br/>(app-of-apps watch dir)"]
    PLAT["platform-apps/<br/>(portal Helm values)"]
    TEN["tenants/&lt;name&gt;/apps/&lt;svc&gt;/<br/>(per-service values + Dockerfile + build.yml)"]
    HELM["helm/app/<br/>(shared chart used by all<br/>tenant apps)"]
  end

  LP --> BP
  BP -->|OIDC assume| ECR[(ECR ssp-portal)]
  PR["Pull request<br/>(AI-generated)"] --> Main
  Main[main branch] --> AOA
  Main --> PLAT
  Main --> TEN
  AOA -.-> Argo[ArgoCD<br/>auto-discovers]
  Argo --> K8s[EKS cluster]
```

### Branch model

- **main** — protected. Only path to production. Merge requires PR.
- **`ssp/<tenant>/<service>/cr-<id>`** — short-lived branches created by the
  orchestrator per CR. Auto-deleted on merge.

### Webhooks

- **PR merge** → `POST https://portal.ssp.mightybee.dev/api/webhooks/github`,
  HMAC-signed with `SSP_GITHUB_WEBHOOK_SECRET`. Handler calls `markProvisioned()`.
- WAF allows the path explicitly (priority 1 rule) — the app verifies the signature.

---

## End-to-end CR flow

```mermaid
sequenceDiagram
  autonumber
  actor User as Vibe Coder
  participant Portal as SSP Portal<br/>(Next.js)
  participant DB as RDS Postgres
  participant Bedrock
  participant GH as GitHub API
  participant Hook as /api/webhooks/github
  participant Argo as ArgoCD
  participant K8s as EKS cluster
  participant ALB
  participant R53 as Route53
  participant Probe as Prober

  User->>Portal: POST /api/services (or new CR on existing)
  Portal->>DB: INSERT cr + service
  Portal->>Portal: runPolicyGate (sync)
  alt policy rejected
    Portal->>DB: cr=policy_gate_rejected,<br/>rev.existence='rejected'
    Portal-->>User: status reflected in UI
  else policy passed
    Portal->>Bedrock: invokeModel (system prompt cached)
    alt AI rejected
      Bedrock-->>Portal: ```reject\n<reason>\n```
      Portal->>DB: cr=ai_validation_rejected,<br/>rev.existence='rejected'
    else AI approved
      Bedrock-->>Portal: artifacts (4 blocks)
      Portal->>DB: cr=ai_artifacts_generated,<br/>rev.existence='created'
      Portal->>Probe: probeRevisionNow (fire-and-forget)
      Portal->>GH: createTree + createPR
      GH-->>Portal: PR URL
      Portal->>DB: cr=platform_reviewing, rev.cd_manifest_ref=<pr_url>
    end
  end

  Note over GH,Hook: Platform engineer reviews + merges
  GH->>Hook: PR merged webhook (HMAC-signed)
  Hook->>DB: cr=applied, rev.cr_status=applied, svc=working
  Argo->>GH: poll main (default 3-min)
  Argo->>K8s: apply Application + Deployment + Service + HTTPRoute
  K8s->>ALB: register IP targets
  K8s->>R53: create A record (via ExternalDNS)
  Probe->>K8s: HTTP GET route_host every 60s
  Probe->>DB: rev.health_status (mirror to svc.current_status)
```

End-to-end measured: ~3 minutes from CR submit to "deployed and probe-healthy" for an
approved CR, with no human input between submit and PR review.

---

## What's NOT in this picture (intentionally)

- **Helm provider from Terraform** — we use ArgoCD instead. Helm-via-Terraform was
  dropped because it conflates IaC drift with application drift.
- **Ingress resources** — Gateway API only. The wildcard `*.ssp.mightybee.dev` cert
  + single Gateway is the only public path.
- **Instance-mode ALB targets** — IP-targets only. Skips the NodePort hop entirely.
- **Per-tenant ALB / per-tenant cert** — one shared ALB and one wildcard cert. Costs
  flat regardless of tenant count.
- **Service mesh** — no Istio / Linkerd. NetworkPolicy + per-namespace IRSA is the
  isolation surface for MVP1.

---

## Operational handles

| Thing | Where |
| --- | --- |
| Portal URL | `https://portal.ssp.mightybee.dev` |
| ArgoCD UI | `https://argocd.ssp.mightybee.dev` |
| Fleet repo | `git@github.com:nguyenhoangnam123/alice-ssp.git` |
| Cluster | `aws eks update-kubeconfig --name ssp-shared --region eu-west-1 --profile alice` |
| Live CR DB | `kubectl -n ssp-portal exec deploy/ssp-portal-app -- node -e ...` (psql not installed in image) |
| Cost view | AWS Console → Billing → Cost Explorer (after activation per `80-cost-governance/README.md`) |
| Budget alerts | `aws budgets describe-budgets --account-id 195748744911 --profile alice` |
