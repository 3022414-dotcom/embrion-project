# Data Model: F-03 — Coordinator and Admin Authentication

**Branch**: `003-coordinator-auth` | **Date**: 2026-05-07
**Input**: spec.md Key Entities + research.md decisions

---

## New Tables (Migration 004)

### `users`

Stores coordinator and admin accounts. Created by seed script or direct DB insert only —
no application endpoint for creation (FR-013, Variant A decision).

```sql
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
```

**Field notes:**
- `email` — case-insensitive uniqueness is enforced at the application layer
  (normalise to lowercase before insert and before lookup).
- `password_hash` — bcrypt output string, format `$2a$12$<salt><hash>` (60 chars).
  Never logged, never returned by any API response.
- `clinic_id` — present for `coordinator`, always NULL for `admin`. The CHECK constraint
  enforces this invariant at the DB level.
- `is_active` — `FALSE` = account deactivated; login endpoint and auth-hook both reject.

---

### `login_attempts`

Records failed login attempts for rate-limiting. One row per failure. No explicit
cleanup — records age out of the 15-minute query window automatically (research Decision 6).

```sql
CREATE TABLE login_attempts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_email_time
  ON login_attempts(email, occurred_at DESC);
```

**Field notes:**
- `email` — stored as-is (the raw value submitted at login time). Rate limiting joins on
  email after application-level normalisation to lowercase.
- Rows for a given email where `occurred_at < NOW() - INTERVAL '15 minutes'` are ignored
  by the rate-limit query but are never deleted by the application.

---

## TypeScript Types

```ts
// apps/api/src/modules/auth/user.repository.ts

export type User = {
  id: string;           // UUID
  email: string;
  passwordHash: string;
  role: 'coordinator' | 'admin';
  clinicId: string | null;  // null for admin
  isActive: boolean;
  createdAt: Date;
};

// Minimal projection used by auth-hook for is_active check
export type UserActiveStatus = {
  isActive: boolean;
};
```

```ts
// apps/api/src/modules/auth/login.service.ts

export type LoginResult =
  | { status: 'ok';        token: string }
  | { status: 'invalid' }                        // wrong password or unknown email
  | { status: 'inactive' }                       // account exists but is_active = false
  | { status: 'rate_limited'; retryAfterSeconds: number };
```

---

## Modified Types (auth-hook.ts)

The `CallerContext` union type defined in F-02 is **unchanged**. F-03 adds a DB lookup
after `jwtVerify()` succeeds — the type contract remains the same.

```ts
// No change to CallerContext — F-02 definition stands:
export type CallerContext =
  | { role: 'coordinator'; sub: string; clinic_id: string }
  | { role: 'admin';       sub: string; clinic_id?: string }
  | { role: 'patient';     sub: string; clinic_id: string;
      selection_id: string; embryo_ids: string[] };
```

---

## Permissions Matrix (F-03 endpoints)

| Endpoint | Method | Allowed roles | Notes |
|----------|--------|---------------|-------|
| `/api/v1/auth/login` | POST | — (public) | No auth header required |

All other existing endpoints remain unchanged — F-03 does not add or remove any
permissions from the F-02 matrix.

---

## Seed Data (dev environment)

Pre-hashed at cost factor 12. The seed script generates hashes at runtime; values below
are illustrative — actual hashes differ per run.

| id (generated) | email | role | clinic_id | is_active |
|----------------|-------|------|-----------|-----------|
| `<uuid>` | coordinator@clinic.test | coordinator | clinic-001 | true |
| `<uuid>` | admin@clinic.test | admin | NULL | true |

Password for both accounts: `password123`
