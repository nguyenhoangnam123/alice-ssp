-- In-portal audit log for guarded_action events. CW Logs remains the
-- authoritative source; this table is the queryable surface for the
-- MCP audit logs tab on the service detail page.

CREATE TABLE IF NOT EXISTS guarded_actions (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id   text,
  action          text NOT NULL,
  resource        text,
  outcome         text NOT NULL,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guarded_actions_tenant_time_idx
  ON guarded_actions (tenant_id, created_at);
