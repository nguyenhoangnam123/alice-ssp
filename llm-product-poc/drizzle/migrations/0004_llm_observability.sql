-- Per-tenant Bedrock budget guard + per-call audit table.
--
-- The orchestrator's checkBudget() refuses to invoke Bedrock for a tenant
-- whose month-to-date SUM(cost_usd) already meets or exceeds the cap. Default
-- $5/mo is intentionally low — a brand-new tenant can't burn the platform
-- bill while we're figuring out their workload shape.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bedrock_monthly_cap_usd numeric(10, 2) NOT NULL DEFAULT 5.00;

CREATE TABLE IF NOT EXISTS llm_calls (
  id                 text PRIMARY KEY,
  change_request_id  text REFERENCES change_requests(id) ON DELETE SET NULL,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_id           text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd           numeric(10, 6) NOT NULL,
  latency_ms         integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_calls_tenant_time_idx
  ON llm_calls (tenant_id, created_at);
