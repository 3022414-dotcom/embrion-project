-- Migration 003: Authorization layer (F-02)
-- Tables: patients, patient_selections, access_tokens, token_audit_log

CREATE TABLE patients (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  TEXT        NOT NULL,
  name       TEXT,
  created_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);

CREATE TABLE patient_selections (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID    NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id  TEXT    NOT NULL,
  embryo_ids UUID[]  NOT NULL DEFAULT '{}',
  created_by TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patient_selections_patient_id ON patient_selections(patient_id);
CREATE INDEX idx_patient_selections_embryo_ids ON patient_selections USING GIN(embryo_ids);

CREATE TABLE access_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_value  TEXT        NOT NULL UNIQUE,
  patient_id   UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  selection_id UUID        NOT NULL REFERENCES patient_selections(id),
  clinic_id    TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  issued_by    TEXT        NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT,
  CONSTRAINT chk_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX idx_access_tokens_patient_id  ON access_tokens(patient_id);
CREATE INDEX idx_access_tokens_token_value ON access_tokens(token_value);

CREATE TABLE token_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id    UUID REFERENCES access_tokens(id),
  event       TEXT NOT NULL CHECK (event IN (
                'issued', 'used', 'revoked', 'expired',
                'expired_attempt', 'unauthorized_attempt'
              )),
  actor_id    TEXT,
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  TEXT
);

CREATE INDEX idx_token_audit_log_token_id    ON token_audit_log(token_id);
CREATE INDEX idx_token_audit_log_occurred_at ON token_audit_log(occurred_at);
