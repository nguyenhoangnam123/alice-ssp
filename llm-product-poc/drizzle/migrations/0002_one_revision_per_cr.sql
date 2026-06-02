-- 1 ChangeRequest → 1 ServiceRevision. Workflow steps live on change_requests.status +
-- change_requests.status_history (append-only event log).

ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'policy_gate_passed';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'policy_gate_rejected';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'ai_validation_passed';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'ai_validation_rejected';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'ai_artifacts_generated';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'platform_reviewing';

ALTER TABLE service_revisions DROP COLUMN IF EXISTS step;
ALTER TABLE service_revisions ADD CONSTRAINT service_revisions_cr_unique UNIQUE (change_request_id);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;
