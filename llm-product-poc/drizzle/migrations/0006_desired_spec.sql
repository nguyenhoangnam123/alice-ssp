-- Shadow-state desired_spec on services. Populated by the orchestrator on
-- CR -> applied transitions. Git remains authoritative for now; this column
-- exists so the controller-pattern flip (Ring 3) has a place to land
-- without a schema-change-at-flip-time risk.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS desired_spec jsonb NOT NULL DEFAULT '{}'::jsonb;
