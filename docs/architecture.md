# SSP Architecture

Five views — all editable Mermaid. Re-render with any Mermaid-aware tool.

## 1. System architecture

```mermaid
flowchart LR
  subgraph Portal["Self-Service Portal — Platform Team"]
    UI["Portal UI"]
    API["Portal API"]
    DB[("Portal DB<br/>Tenant / Service / CR / Revision")]
    SF["Step Functions<br/>orchestrator"]
    AI["AI Agent<br/>Bedrock Claude"]
    POL["Policy Gate<br/>OPA / Conftest"]
  end

  subgraph Auth["Auth — DevOps-owned"]
    COG["AWS Cognito<br/>single user pool + RBAC"]
  end

  subgraph Git["GitOps — Source of Truth"]
    APP["App Git Repo (GitHub)"]
    FM["Fleet-Manager Repo<br/>Terraform + Helm + ArgoCD"]
  end

  subgraph EKS["AWS / EKS — DevOps-owned Foundation"]
    AR["ArgoCD"]
    NSA["ns: tenant-a<br/>Quota + NetPol + IRSA"]
    NSB["ns: tenant-b"]
    BR["Amazon Bedrock"]
  end

  subgraph Obs["Observability & Cost"]
    CW["CloudWatch + Container Insights"]
    OC["Split Cost Allocation + OpenCost"]
  end

  Dev["Employee Laptop"] -->|"Claude Code (authoring)"| APP
  Dev --> UI
  UI --> API
  API --> COG
  API --> DB
  API --> SF
  SF --> AI
  SF --> POL
  AI --> FM
  FM --> AR
  AR --> NSA
  AR --> NSB
  NSA -->|"scoped IAM"| BR
  NSB -->|"scoped IAM"| BR
  EKS --> CW
  EKS --> OC
```

## 2. Authoritative provisioning workflow

```mermaid
sequenceDiagram
    actor U as User (Cognito)
    participant P as Portal API
    participant SF as Step Functions
    participant AI as AI Agent (Bedrock)
    participant POL as Policy Gate (OPA)
    participant FM as Fleet Repo (GitHub)
    participant PE as Platform Engineer
    participant AR as ArgoCD
    participant K as EKS
    participant SNS as SNS Fanout

    U->>P: Submit service / ChangeRequest<br/>(git repo, domain, resources, description)
    P->>P: RBAC check (UserTenant); write CR + Revision
    P->>SF: Start workflow
    Note over SF: status: aiReview
    SF->>SNS: notify (aiReview)
    SF->>AI: Review request + repo + CR history
    AI->>POL: Deterministic checks<br/>(quota, Dockerfile, domain free)
    alt Gaps found (no Dockerfile / CI)
        AI->>AI: Generate Dockerfile / CI / manifests
    end
    AI->>FM: Open PR (Terraform + Helm + ArgoCD)
    Note over SF: status: platformReview
    SF->>SNS: notify (platformReview)
    PE->>FM: Review & merge PR
    FM->>AR: Argo detects change
    Note over SF: status: provisioning
    SF->>SNS: notify (provisioning)
    AR->>K: Sync (tenant namespace + app)
    K-->>AR: Healthy
    AR-->>SF: Sync status (webhook)
    Note over SF: status: working
    SF->>SNS: notify (working)
    SNS-->>P: Update currentStatus (projection)
    SNS-->>U: Email / Slack
    SNS-->>PE: Email / Slack
```

## 3. Data model

```mermaid
erDiagram
    TENANT ||--o{ USER_TENANT : "has"
    USER  ||--o{ USER_TENANT : "member of"
    TENANT ||--o{ SERVICE : "owns"
    SERVICE ||--o{ CHANGE_REQUEST : "has"
    CHANGE_REQUEST ||--o{ SERVICE_REVISION : "produces"
    SERVICE ||--o{ SERVICE_REVISION : "evolves through"

    TENANT {
        uuid id PK
        string domain "immutable, unique"
        json tags "propagated to AWS for cost"
        string department
        string head_of_department
    }
    USER_TENANT {
        uuid user_id FK
        uuid tenant_id FK
        string role "admin (MVP1)"
    }
    USER {
        uuid id PK
        string cognito_sub "from Cognito"
        string email
    }
    SERVICE {
        uuid id PK
        uuid tenant_id FK
        string subdomain "nullable if not exposed"
        bool vpn_internal
        string git_repo
        string description "mandatory, AI prompt input"
        enum current_status "na | aiReview | platformReview | provisioning | working"
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }
    CHANGE_REQUEST {
        uuid id PK
        uuid service_id FK
        uuid requested_by FK
        string status
        datetime created_at
    }
    SERVICE_REVISION {
        uuid id PK
        uuid change_request_id FK
        uuid service_id FK
        string service_status
        string cr_status
        string ci_pipeline_ref
        string dockerfile_snapshot "AI-generated, frozen"
        string cd_manifest_ref "git SHA / PR URL / path"
        text ai_summary
        datetime created_at
    }
```

## 4. Service status lifecycle

```mermaid
stateDiagram-v2
    [*] --> NA : Service created
    NA --> aiReview : CR submitted
    aiReview --> platformReview : AI validated + PR opened
    aiReview --> NA : Rejected (invalid request)
    platformReview --> provisioning : PR merged by platform eng
    platformReview --> aiReview : Changes requested
    provisioning --> working : ArgoCD sync healthy
    provisioning --> platformReview : Sync failed / rollback
    working --> aiReview : New ChangeRequest
    working --> [*] : Service deleted
```

## 5. EKS multi-tenancy boundary

```mermaid
flowchart TB
  subgraph Cluster["EKS Cluster — shared, DevOps-owned"]
    AR["ArgoCD (reconciles fleet repo)"]
    ING["Internal Ingress / ALB<br/>VPN-only, host-based routing"]

    subgraph NSA["Namespace: tenant-a"]
      PA["App pods"]
      QA["ResourceQuota + LimitRange"]
      NPA["NetworkPolicy: deny cross-ns"]
      SAA["ServiceAccount + IRSA"]
    end

    subgraph NSB["Namespace: tenant-b"]
      PB["App pods"]
      QB["ResourceQuota + LimitRange"]
      NPB["NetworkPolicy"]
      SAB["ServiceAccount + IRSA"]
    end
  end

  BR["Amazon Bedrock"]
  COST["Split Cost Allocation Data<br/>per-namespace cost via tenant tags"]

  SAA -->|"scoped IAM"| BR
  SAB -->|"scoped IAM"| BR
  Cluster --> COST
```

## Ownership at a glance

- **Central DevOps** owns everything in the EKS / AWS foundation: the cluster, networking, ArgoCD install, shared ALB/ingress, Cognito pool provisioning, and account guardrails (SCPs, permission boundaries).
- **Platform team** owns the portal, the authoritative workflow (Step Functions + Bedrock agent + policy gate), the per-tenant Terraform/Helm modules in the fleet repo, the cost-tagging conventions, and the developer experience.
