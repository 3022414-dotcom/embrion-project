# Data Model: F-02 — Authorization Layer

**Branch**: `002-role-auth` | **Date**: 2026-05-05
**Input**: spec.md + research.md

---

## New Tables

### patients

Minimal patient identity record. No credentials (login deferred to F-03).
One patient belongs to exactly one clinic.

```sql
CREATE TABLE patients (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  TEXT    NOT NULL,                          -- matches clinic_id JWT claim
  name       TEXT,                                      -- optional display name
  created_by TEXT    NOT NULL,                          -- coordinator sub from JWT
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | auto-generated |
| clinic_id | TEXT | NOT NULL | from coordinator JWT `clinic_id` claim |
| name | TEXT | nullable | optional; UI display only |
| created_by | TEXT | NOT NULL | coordinator `sub` from JWT at creation time |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

---

### patient_selections

One active selection per patient (UNIQUE on patient_id). Contains an ordered
array of embryo UUIDs the coordinator has curated for this patient.
Edited in-place — no versioning.

```sql
CREATE TABLE patient_selections (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID    NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id   TEXT    NOT NULL,                         -- denormalized for fast auth checks
  embryo_ids  UUID[]  NOT NULL DEFAULT '{}',            -- ordered list of embryo UUIDs
  created_by  TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patient_selections_patient_id ON patient_selections(patient_id);
CREATE INDEX idx_patient_selections_embryo_ids ON patient_selections USING GIN(embryo_ids);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| patient_id | UUID | NOT NULL, UNIQUE, FK → patients | enforces 1 selection per patient |
| clinic_id | TEXT | NOT NULL | denormalized from patient.clinic_id |
| embryo_ids | UUID[] | NOT NULL, DEFAULT '{}' | ordered array; GIN indexed for membership checks |
| created_by | TEXT | NOT NULL | coordinator sub |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | updated on every embryo_ids change |

**Membership check**: `embryo_id = ANY(embryo_ids)` — used in patient-scoped embryo queries.

---

### access_tokens

One active token per patient at any time. Issuing a new token revokes the
previous one (enforced in service layer). Token value has 256-bit entropy.

```sql
CREATE TABLE access_tokens (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  token_value  TEXT  NOT NULL UNIQUE,                   -- 64-char hex, 256-bit entropy
  patient_id   UUID  NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  selection_id UUID  NOT NULL REFERENCES patient_selections(id),
  clinic_id    TEXT  NOT NULL,                          -- denormalized for fast validation
  expires_at   TIMESTAMPTZ NOT NULL,
  issued_by    TEXT  NOT NULL,                          -- coordinator/admin sub
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,                             -- null = active
  revoked_by   TEXT,                                    -- null = not revoked
  CONSTRAINT chk_revoked CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL)
  )
);

CREATE INDEX idx_access_tokens_patient_id   ON access_tokens(patient_id);
CREATE INDEX idx_access_tokens_token_value  ON access_tokens(token_value);  -- lookup hot path
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| token_value | TEXT | NOT NULL, UNIQUE | `crypto.randomBytes(32).toString('hex')` |
| patient_id | UUID | NOT NULL, FK → patients | |
| selection_id | UUID | NOT NULL, FK → patient_selections | determines visible embryos |
| clinic_id | TEXT | NOT NULL | denormalized for fast auth |
| expires_at | TIMESTAMPTZ | NOT NULL | set at issuance; default TTL 30 days |
| issued_by | TEXT | NOT NULL | coordinator/admin sub |
| issued_at | TIMESTAMPTZ | NOT NULL | |
| revoked_at | TIMESTAMPTZ | nullable | null = active |
| revoked_by | TEXT | nullable | null = not revoked |

**Active token query** (hot path, indexed): `WHERE token_value = $1 AND revoked_at IS NULL AND expires_at > NOW()`

---

### token_audit_log

Immutable event log for all token lifecycle and failed access attempt events.

```sql
CREATE TABLE token_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id    UUID REFERENCES access_tokens(id),       -- nullable (unknown tokens)
  event       TEXT NOT NULL CHECK (event IN (
                'issued', 'used', 'revoked', 'expired',
                'expired_attempt', 'unauthorized_attempt'
              )),
  actor_id    TEXT,                                     -- nullable for unauthenticated
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  TEXT
);

CREATE INDEX idx_token_audit_log_token_id    ON token_audit_log(token_id);
CREATE INDEX idx_token_audit_log_occurred_at ON token_audit_log(occurred_at);
```

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| token_id | UUID | nullable, FK → access_tokens | null for unrecognised tokens |
| event | TEXT | CHECK constraint (6 values) | |
| actor_id | TEXT | nullable | null for unauthenticated requests |
| actor_role | TEXT | nullable | |
| occurred_at | TIMESTAMPTZ | NOT NULL | |
| ip_address | TEXT | nullable | from request headers |

---

## TypeScript Types (new to packages/schema or apps/api)

### Request Caller Context

Unified caller identity — set by the `onRequest` auth hook, consumed by
middleware and handlers. Lives in `apps/api/src/middleware/auth-hook.ts`.

```typescript
// apps/api/src/middleware/auth-hook.ts
export type CallerContext =
  | { role: 'coordinator'; sub: string; clinic_id: string }
  | { role: 'admin'; sub: string; clinic_id?: string }
  | { role: 'patient'; sub: string; clinic_id: string; selection_id: string; embryo_ids: string[] };

// FastifyRequest augmentation (replaces F-01's jwtPayload)
declare module 'fastify' {
  interface FastifyRequest {
    caller?: CallerContext;
  }
}
```

### JWT Claims (Coordinator / Admin)

Extends F-01's `{ sub, role }` payload with `clinic_id`.

```typescript
// apps/api/src/middleware/auth-hook.ts
interface CoordinatorJwtClaims {
  sub: string;
  role: 'coordinator' | 'admin';
  clinic_id: string;  // required for coordinator; ignored for admin (no clinic filter)
  iat?: number;
  exp?: number;
}
```

---

## Entity Relationships

```
Clinic (external — identified by clinic_id TEXT from JWT)
  └── patients (1:N)
        └── patient_selections (1:1, UNIQUE)
              └── access_tokens (1:N, but 1 active at a time)
                    └── token_audit_log (1:N)

embryos (from F-01)  ←── referenced by patient_selections.embryo_ids[]
```

---

## Permissions Matrix (authoritative)

| Resource / Action | patient | coordinator | admin |
|-------------------|---------|-------------|-------|
| GET /embryos, GET /embryos/:id | ✅ scoped to selection | ✅ scoped to clinic | ✅ all |
| POST /embryos | ❌ 403 | ✅ | ✅ |
| PATCH /embryos/:id | ❌ 403 | ✅ scoped to clinic | ✅ |
| PATCH /embryos/:id/status | ❌ 403 | ✅ scoped to clinic | ✅ |
| POST /embryos/:id/delete | ❌ 403 | ❌ 403 | ✅ |
| POST /patients | ❌ 403 | ✅ (own clinic) | ✅ |
| GET/PATCH /patients/:id/selection | ❌ 403 | ✅ (own clinic) | ✅ |
| POST /patients/:id/token | ❌ 403 | ✅ (own clinic) | ✅ |
| DELETE /patients/:id/token | ❌ 403 | ✅ (own clinic) | ✅ |

---

## Validation Rules

| Field | Rule |
|-------|------|
| `access_tokens.token_value` | 64-character hex string; UNIQUE |
| `access_tokens.expires_at` | MUST be in the future at issuance time |
| `access_tokens.revoked_at` | If set, MUST be ≤ NOW() |
| `patient_selections.embryo_ids` | All IDs MUST reference existing embryos in the same clinic |
| `patients.clinic_id` | MUST match coordinator's JWT `clinic_id` claim at creation time |
| Token TTL | Configurable; default 30 days; minimum 1 hour; maximum 365 days |
