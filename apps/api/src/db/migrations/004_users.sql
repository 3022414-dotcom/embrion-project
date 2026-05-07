CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('coordinator', 'admin')),
  clinic_id     TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_coordinator_requires_clinic
    CHECK (
      (role = 'coordinator' AND clinic_id IS NOT NULL) OR
      (role = 'admin'       AND clinic_id IS NULL)
    )
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE login_attempts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_email_time
  ON login_attempts(email, occurred_at DESC);
