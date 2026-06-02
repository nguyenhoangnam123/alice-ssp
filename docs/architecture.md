# Architecture

## System diagram

```mermaid
flowchart LR
  subgraph Portal["llm-product-poc (platform-team owned)"]
    UI["Next.js 15 UI"]
    API["Next.js API / Server Actions"]
    DB[("RDS Postgres 16.14<br/>tenants / users / services /<br/>change_requests / service_revisions")]
    Orchestrator["In-process workflow<br/>(MVP2: Step Functions)"]
    Policy["Deterministic policy gate<br/>(MVP2: OPA)"]
    Agent["Bedrock AI agent<br/>Opus 4.6 + prompt cache"]
    PR["Octokit PR opener"]
  end

  subgraph Identity["Cognito (DevOps-owned)"]
    Pool["User pool eu-west-1_zEVRIg5JY"]
  end

  subgraph Git["GitOps source of truth"]
    Repo["nguyenhoangnam123/alice-ssp<br/>monorepo: fleet-managers/ + llm-product-poc/"]
  end

  subgraph EKS["EKS ssp-shared (DevOps-owned)"]
    Argo["ArgoCD<br/>App-of-Apps"]
    LBC["AWS LB Controller v3.3.0<br/>Gateway API + Ingress"]
    ESO["External Secrets Operator<br/>IRSA → KMS + Secrets Manager"]
    Cert["cert-manager"]
    ExtDNS["External-DNS → Route53"]
    PortalNS["ns: ssp-portal"]
    TenantNS["ns: tenant-acme<br/>Quota + LimitRange + NetPol"]
    Bedrock["Amazon Bedrock<br/>via IRSA role ssp-portal-app"]
  end

  subgraph Front["Internet"]
    DNS["Route53 zone<br/>ssp.mightybee.dev"]
    WAF["WAFv2 WebACL<br/>ssp-shared-public-alb"]
    ALB["Internet-facing ALB<br/>Gateway alb-public-shared"]
  end

  User["Product engineer"] --> UI
  UI --> API
  API --> DB
  API --> Pool
  API --> Orchestrator
  Orchestrator --> Policy
  Orchestrator --> Agent
  Agent --> Bedrock
  Orchestrator --> PR
  PR --> Repo
  Repo --> Argo
  Argo --> PortalNS
  Argo --> TenantNS
  DNS --> WAF
  WAF --> ALB
  ALB --> PortalNS
  ALB --> TenantNS
```

## Ownership boundaries

| Layer | Owner | Tooling |
| --- | --- | --- |
| AWS account, SCPs, IAM permission boundaries | Central DevOps | Terraform foundation layers |
| EKS cluster, VPC, ArgoCD install, Cognito pool, shared ALBs, Route53, KMS | DevOps | `fleet-managers/terraform/foundation/00-*..50-*` |
| GitOps repo + Helm chart + ApplicationSet + per-tenant Terraform modules | Platform team | `fleet-managers/terraform/modules/`, `fleet-managers/helm/app/`, `fleet-managers/argocd/` |
| Portal (Next.js app + AI agent + workflow + Octokit) | Platform team | `llm-product-poc/` |
| Tenant workloads + ChangeRequest payloads | Tenants | Submitted through the portal, reviewed by platform team |

The seam is deliberate: a tenant cannot edit Terraform, the platform team cannot edit
tenant application code, and DevOps cannot accidentally change a tenant's namespace
labels (because everything is in git and ArgoCD reconciles continuously).

## Authoritative workflow

```mermaid
sequenceDiagram
    actor U as Product engineer
    participant P as Portal API
    participant Pol as Policy gate
    participant Bed as Bedrock (Opus 4.6)
    participant Gh as Octokit
    participant Repo as alice-ssp
    participant PE as Platform engineer
    participant Arg as ArgoCD
    participant K as EKS

    U->>P: POST /api/services (CR)
    P->>P: Zod validate, RBAC, insert CR + revision
    Note over P: status: submitted
    P->>Pol: deterministic gate
    alt gate fails
        P->>P: revision(rejected) + status=rejected
    else
        Note over P: status: aiReview
        P->>Bed: InvokeModel(system + user)
        alt AI rejects
            Bed-->>P: ```reject (REASON)
            P->>P: revision(rejected) + status=rejected
        else AI approves
            Bed-->>P: 4 fenced blocks
            P->>Gh: create branch + tree + commit + PR
            Gh->>Repo: PR opened
            Note over P: status: platformReview
            P->>P: revision(platformReview) with PR URL
            PE->>Repo: review + merge
            Repo->>Arg: webhook (auto-sync also picks up within 3min)
            Arg->>K: sync tenant Application
            K-->>Arg: Healthy
            Note over P: status: working (MVP2 — ArgoCD webhook)
        end
    end
```

## Data model

```mermaid
erDiagram
    TENANT ||--o{ USER_TENANT : "has"
    USER ||--o{ USER_TENANT : "member of"
    TENANT ||--o{ SERVICE : "owns"
    SERVICE ||--o{ CHANGE_REQUEST : "has"
    CHANGE_REQUEST ||--o{ SERVICE_REVISION : "produces"

    TENANT {
        uuid id PK
        string domain "immutable, unique, Postgres trigger enforced"
        json tags "propagated to AWS for cost"
        string department
        string head_of_department
    }
    USER {
        uuid id PK
        string cognito_sub "from Cognito"
        string email
    }
    USER_TENANT {
        uuid user_id FK
        uuid tenant_id FK
        enum role "admin (MVP1)"
    }
    SERVICE {
        uuid id PK
        uuid tenant_id FK
        string subdomain "nullable if VPN-only"
        bool vpn_internal
        string git_repo
        text description "≥20 chars, AI prompt input"
        enum current_status "na | aiReview | platformReview | provisioning | working | rejected"
    }
    CHANGE_REQUEST {
        uuid id PK
        uuid service_id FK
        uuid requested_by FK
        enum status "submitted → aiReviewing → (rejected | platformReviewing → ...)"
        string summary
        json payload "free-form desired-state shape"
    }
    SERVICE_REVISION {
        uuid id PK
        uuid change_request_id FK
        uuid service_id FK
        enum service_status
        enum cr_status
        string ci_pipeline_ref
        text dockerfile_snapshot "frozen AI output"
        string cd_manifest_ref "PR URL"
        text ai_summary "markdown: Current/Desired/Summary or Rejected reason"
        timestamp created_at
    }
```

`SERVICE_REVISION` is append-only — the audit trail for who-asked-for-what-and-when.
`TENANT.domain` is enforced immutable by a Postgres `BEFORE UPDATE` trigger so
cost-allocation history doesn't break on a rename.

## EKS multi-tenancy boundary

```mermaid
flowchart TB
  subgraph Cluster["EKS ssp-shared"]
    Arg["ArgoCD"]

    subgraph GW["gateway-system (platform-shared)"]
      Gpub["Gateway alb-public-shared<br/>internet-facing<br/>HTTPS via ACM cert"]
      Gint["Gateway alb-internal-shared<br/>internal"]
    end

    subgraph SP["ssp-portal (platform-tenant)"]
      Pod1["portal pod<br/>SA: ssp-portal-app<br/>IRSA → Bedrock"]
      ES1["ExternalSecret portal-db, portal-github"]
    end

    subgraph TA["tenant-acme"]
      Pod2["tenant pods<br/>SA bound to scoped IAM"]
      Quota["ResourceQuota + LimitRange"]
      NetPol["NetworkPolicy: deny cross-ns"]
    end
  end

  Front["Internet → WAF → ALB"] --> Gpub
  Vpn["VPN → internal ALB"] --> Gint
  Gpub -->|HTTPRoute selector| SP
  Gpub -->|HTTPRoute selector| TA
  Pod1 -.->|Bedrock IAM| AWS[Amazon Bedrock]
  Pod2 -.->|scoped IAM| AWS2[S3 tenants/<id>/ + Bedrock]
```

A tenant can attach an `HTTPRoute` to a shared `Gateway` only when their namespace
carries the `ssp.platform/tenant` label, which only the Terraform `tenant-namespace`
module sets. The `NetworkPolicy` denies cross-namespace ingress by default. IRSA scopes
each tenant's pods to a per-tenant IAM role limited to `bedrock:InvokeModel` and the
tenant's S3 prefix.

## Foundation Terraform layers

| Layer | Purpose | Idle cost |
| --- | --- | --- |
| `00-bootstrap` | S3 + DynamoDB state backend + KMS CMK for secrets | <$1/mo |
| `10-vpc` | VPC, 3 AZs, 1 NAT (dev), tagged for ALB/EKS subnet auto-discovery | ~$32/mo |
| `15-dns` | Route53 zone `ssp.mightybee.dev` + ACM cert for portal | <$1/mo |
| `20-eks` | Cluster + 2× t3.medium + OIDC + EKS-native addons | ~$133/mo |
| `30-cognito` | User pool, app client, Hosted UI, platform-engineer group | free tier |
| `40-platform-addons` | LBC (Gateway API), Gateway API CRDs, External-DNS, cert-manager, ESO, metrics-server, two GatewayClasses + LBConfigs + shared Gateways | ~$32/mo (2 ALBs) |
| `45-waf` | WebACL: AWS managed rules + IP-rep + SQLi + rate-limit; CloudWatch logging | ~$5–15/mo |
| `50-argocd` | ArgoCD + App-of-Apps root | $0 (in-cluster) |
| `55-ecr` | ECR repo `ssp-portal` + GitHub Actions OIDC role | <$1/mo |
| `60-portal-data` | RDS Postgres + master creds in Secrets Manager (KMS-encrypted) | ~$15/mo |
| `70-portal-app` | Portal namespace + ExternalSecrets + portal IRSA role w/ Bedrock | $0 |
