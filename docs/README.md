# SSP — Design Doc

Five files, mapped 1:1 to the spec's eight Deliverable-1 sections.

| File | Spec sections covered |
| --- | --- |
| [deliverable1-01-architecture.md](./deliverable1-01-architecture.md) | Target architecture + Tenancy & isolation |
| [deliverable1-02-observability-and-cost.md](./deliverable1-02-observability-and-cost.md) | Observability & cost (LLM token cost as first-class signal + tracing across the agent / tool-call chain) |
| [deliverable1-03-guardrails.md](./deliverable1-03-guardrails.md) | Guardrails (prompt injection, PII, model allowlists, human-in-the-loop, audit) |
| [deliverable1-04-lifecycle-and-ownership.md](./deliverable1-04-lifecycle-and-ownership.md) | Lifecycle (provisioning, updates, secret rotation, retirement) + Ownership boundary + Rollout shape |
| [deliverable1-05-tradeoffs.md](./deliverable1-05-tradeoffs.md) | Tradeoffs (four real decisions with reasoning + cost) |

## Deliverable 2 (code slice)

Lives in code directories, not here:

| Option | Where |
| --- | --- |
| **B — Observability MCP server** | [`../mcp-server/`](../mcp-server/) — runnable, with toy app |
| **A — Per-tenant isolation Terraform** | [`../fleet-managers/terraform/foundation/tenants/`](../fleet-managers/terraform/foundation/tenants/) |
| **D — "Submit a vibe-coded app" portal slice** | [`../llm-product-poc/`](../llm-product-poc/) — runs live at https://portal.ssp.mightybee.dev |

## Deliverable 3 (README)

Top-level [README.md](../README.md). Covers how to run, what to do given another day, AI-tool collaboration.
