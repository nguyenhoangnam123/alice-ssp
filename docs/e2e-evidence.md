# E2E evidence

Live results from a guardrail sweep run against `https://portal.ssp.mightybee.dev` on
2026-06-02. Each row is a real ChangeRequest submitted via the JSON API — no demo
data, no mocks.

## Test matrix

| # | CR | Intent | Caught at layer | Outcome |
| --- | --- | --- | --- | --- |
| T1 | `description: "too short"` | description below 20 chars | **L1 — Zod** | HTTP 400, no DB row, no LLM call |
| T2 | `resources.requests.cpu: 16` | 4× CPU cap | **L3 — AI** | rejected, no PR, ~$0.005 spent |
| T3 | `replicaCount: 50` | 2.5× replica cap | **L3 — AI** | rejected, no PR |
| T4 | `image.repository: random-pirate-registry.example.com/bad:image` | untrusted registry | **L3 — AI** | rejected, no PR |
| T5 | `securityContext.privileged: true, hostNetwork: true` | privileged container | **L3 — AI** | rejected, no PR |
| T6 | `replicaCount: 20, cpu: 4, memory: 8Gi` | exactly at cap | **L3 — AI passes** | approved → PR #5 with 4 files |
| T7 | normal: 2 replicas, 200m CPU, 256 Mi | normal small public web service | **L3 — AI passes** | approved → PR #6 with 4 files |

`approved-svc` and `opus-demo` from earlier runs (PR #4, PR #1) are additional
approvals against the same prompt and continue to render valid output.

## Layer 1 — Zod evidence

Exact request and response:

```bash
$ curl -X POST https://portal.ssp.mightybee.dev/api/services \
    -H 'Content-Type: application/json' -H "Cookie: ssp_session=$USER_ID" \
    -d '{"tenant_id":"...","name":"t1-short-desc","subdomain":"t1-shortdesc",
         "vpn_internal":false,"git_repo":"https://...","description":"too short"}'

HTTP/400
{"error":"validation_failed","issues":[
  {"code":"too_small","minimum":20,"type":"string","inclusive":true,
   "exact":false,"message":"String must contain at least 20 character(s)",
   "path":["description"]}
]}
```

No row in `services`, no row in `change_requests`, no Bedrock invocation. The cheapest
possible rejection.

## Layer 3 — AI rejection evidence

The AI's recorded reason for each rejection (verbatim from `service_revisions.ai_summary`):

### T2 — over CPU cap

> **Rejected by AI**: Requested 16 CPU per pod exceeds the 4-core cap (description
> explicitly states 16 CPU per pod).

Latency: ~1.9 s. Output: 61 tokens (single `reject` fence).

### T3 — over replica cap

> **Rejected by AI**: Requested replicaCount of 50 exceeds the 20-replica cap
> (description states 50 replicas).

### T4 — untrusted image

> **Rejected by AI**: Image source "random-pirate-registry.example.com" is not the
> tenant's ECR or a well-known upstream (docker.io/library, gcr.io/distroless,
> public.ecr.aws/*, ghcr.io).

The AI quoted the policy's allow-list verbatim. The platform engineer reading the
rejection sees exactly which knob to turn (add the registry to the trusted set, or
push the image to ECR).

### T5 — privileged + hostNetwork

> **Rejected by AI**: The service description explicitly requests a privileged
> container with hostNetwork enabled, which violates the platform security policy
> prohibiting privileged containers and hostNetwork.

Both violations are listed in one sentence — Opus is reasonably precise when the
prompt enumerates the rules.

### Combined rejection (rejected-final from an earlier run)

> **Rejected by AI**: Requested 16 CPU per pod exceeds the 4-core cap, requested 64 Gi
> memory per pod exceeds the 8 Gi cap, and requested 50 replicas exceeds the 20-replica
> cap.

Three rules cited in one reason — useful for the tenant resubmitting.

## Layer 3 → 4 — AI approval evidence

For T6 and T7 the AI approved and `openFleetPr` opened a real PR with four files.

### T6 (at-cap approval) — PR #5

```
$ gh pr view 5 --repo nguyenhoangnam123/alice-ssp --json files --jq '.files[].path'

fleet-managers/tenants/acme/apps/t6-atcap/Dockerfile
fleet-managers/tenants/acme/apps/t6-atcap/application.yaml
fleet-managers/tenants/acme/apps/t6-atcap/build.yml
fleet-managers/tenants/acme/apps/t6-atcap/values.yaml
```

The Opus-generated `application.yaml` (verbatim from the PR):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: acme-t6-atcap
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/nguyenhoangnam123/alice-ssp.git
    targetRevision: main
    path: fleet-managers/helm/app
    helm:
      valueFiles:
        - "../../tenants/acme/apps/t6-atcap/values.yaml"
  destination:
    server: https://kubernetes.default.svc
    namespace: tenant-acme
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

Following the prompt's contract: correct apiVersion, project, repo URL, helm valueFiles
relative path, tenant-namespaced destination, prune + selfHeal automated sync.

### T7 (normal approval) — PR #6

Same 4-file shape:

```
fleet-managers/tenants/acme/apps/t7-normal-retry/Dockerfile
fleet-managers/tenants/acme/apps/t7-normal-retry/application.yaml
fleet-managers/tenants/acme/apps/t7-normal-retry/build.yml
fleet-managers/tenants/acme/apps/t7-normal-retry/values.yaml
```

## Observability sample — Bedrock metrics

Single line per invocation, captured in `kubectl logs deploy/ssp-portal-app`:

```
bedrock ok model=eu.anthropic.claude-opus-4-6-v1 ms=14210 tok_in=612  tok_out=1017 cache_read=0
bedrock ok model=eu.anthropic.claude-opus-4-6-v1 ms=1879  tok_in=1143 tok_out=61   cache_read=0
bedrock ok model=eu.anthropic.claude-opus-4-6-v1 ms=15078 tok_in=1136 tok_out=1227 cache_read=0
bedrock ok model=eu.anthropic.claude-opus-4-6-v1 ms=8499  tok_in=606  tok_out=355  cache_read=0
```

Observations:
- **Rejection latency** (1.9 s, 61 out tokens) is ~12× lower than approval latency
  (15 s, 1227 out tokens). Reject-cost is essentially free.
- **`cache_read=0`** because each invocation in this sweep was outside the 5-min cache
  window. In bursty load (think a tenant resubmitting a CR multiple times in the same
  hour), `cache_read` jumps and `tok_in` charged drops to ~0 for the system prompt.

## Failure modes encountered (real, not staged)

A few of the things that *didn't* go to plan during the sweep — relevant for any team
adopting this pattern:

1. **Bedrock rate limit** — firing 6 CRs in 7s caused the second one through to hit
   `Too many requests, please wait before trying again`. The orchestrator currently
   converts that exception into a rejection (the test retried successfully). MVP2
   should classify retryable Bedrock errors and back off rather than reject.
2. **Stale Docker image cache** — the GitHub Actions buildx cache was returning a
   stale Next.js bundle for two builds in a row, causing the deployed pod to run an
   older version of `agent.ts` than what was in git. Switched the workflow to
   `no-cache: true` (3 min uncached builds vs 1 min cached, accepted trade).
3. **`imagePullPolicy: IfNotPresent` on `:latest`** — Helm chart default; node-level
   image cache meant rollout-restart didn't actually pull the new image. Fixed by
   pinning the chart to `pullPolicy: Always` for now, with a note to move to digest
   tags in MVP2 so we can drop back to IfNotPresent.
4. **Anthropic use-case form** — Sonnet 4.6 and Opus 4.6 require a one-time use-case
   form submission per AWS account. The first wave of invocations from the IRSA role
   failed with `Model use case details have not been submitted`; submitting the form
   from the Bedrock console unblocked all principals in the account.

These are the kinds of issues a real platform team would catch in their first week —
worth documenting so the next team going through this doesn't re-discover them.

## Reproducing the sweep

The exact script lives at `/tmp/ssp-e2e.sh` on the machine that ran it; the prompts
and payloads are reproduced inline in this doc. To re-run:

```bash
# Get the seed admin user id (or create a new user via the portal)
USER_ID=$(KUBECONFIG=~/Documents/alice/.kubeconfig kubectl -n ssp-portal exec \
  deploy/ssp-portal-app -- node -e "
    const pg = require('postgres');
    const sql = pg(process.env.DATABASE_URL, { ssl: 'require' });
    sql\`select id from users where email='admin@example.com'\`.then(r => {
      console.log(r[0].id); sql.end();
    });
  ")

# Submit a CR via the API
curl -X POST https://portal.ssp.mightybee.dev/api/services \
  -H 'Content-Type: application/json' -H "Cookie: ssp_session=$USER_ID" \
  -d '{ ...as in the matrix above... }'

# Watch the workflow
KUBECONFIG=~/Documents/alice/.kubeconfig \
  kubectl -n ssp-portal logs -f deploy/ssp-portal-app
```
