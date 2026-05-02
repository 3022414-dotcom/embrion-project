-- Migration: 002_embryo_status_log
-- Description: Audit log for embryo status transitions (FR-009)

CREATE TABLE embryo_status_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  embryo_id   UUID NOT NULL,
  from_status embryo_status NOT NULL,
  to_status   embryo_status NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX embryo_status_log_embryo_id_idx ON embryo_status_log (embryo_id);
CREATE INDEX embryo_status_log_changed_at_idx ON embryo_status_log (changed_at);
