-- Two independent dimensions on each revision:
--   existence_status: 'created' or 'rejected' (NULL while in-flight before terminal step).
--   health_status:    'healthy' / 'unhealthy' / 'unknown' — updated by the periodic prober.
--
-- The Service's currentStatus mirrors the latest revision's combined status.

ALTER TABLE service_revisions ADD COLUMN IF NOT EXISTS existence_status text;
ALTER TABLE service_revisions ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE service_revisions ADD COLUMN IF NOT EXISTS last_probed_at timestamptz;
ALTER TABLE service_revisions ADD COLUMN IF NOT EXISTS route_host text;
