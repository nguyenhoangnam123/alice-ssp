-- Add per-step workflow event tagging to service_revisions.
-- Orchestrator writes one row per workflow step (policy_gate_passed,
-- ai_validation_passed/rejected, ai_artifacts_generated, pr_opened, pr_merged).

ALTER TABLE service_revisions ADD COLUMN IF NOT EXISTS step text;
