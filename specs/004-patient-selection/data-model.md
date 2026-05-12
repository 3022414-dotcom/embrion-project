# Data Model: F-04 — Персонализированная подборка

**Branch**: `004-patient-selection` | **Date**: 2026-05-08

---

## Schema Changes

### Migration 005 — `apps/api/src/db/migrations/005_selection_opened_at.sql`

```sql
-- Migration 005: Add opened_at to patient_selections (F-04)
ALTER TABLE patient_selections
  ADD COLUMN opened_at TIMESTAMPTZ;

COMMENT ON COLUMN patient_selections.opened_at
  IS 'Timestamp of first patient access via token. NULL until patient first opens their selection.';
```

No index required — `opened_at` is never used as a filter, only read for display.

---

## Existing Entities (referenced, not changed except noted)

### `patients` (F-02, unchanged)

| Column     | Type        | Constraints                  |
|------------|-------------|------------------------------|
| id         | UUID        | PK, gen_random_uuid()        |
| clinic_id  | TEXT        | NOT NULL                     |
| name       | TEXT        | nullable                     |
| created_by | TEXT        | NOT NULL (coordinator UUID)  |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW()       |

### `patient_selections` (F-02, extended by F-04)

| Column     | Type        | Constraints                              |
|------------|-------------|------------------------------------------|
| id         | UUID        | PK                                       |
| patient_id | UUID        | NOT NULL UNIQUE FK → patients(id)        |
| clinic_id  | TEXT        | NOT NULL                                 |
| embryo_ids | UUID[]      | NOT NULL DEFAULT '{}'                    |
| created_by | TEXT        | NOT NULL                                 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW()                   |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW()                   |
| **opened_at** | **TIMESTAMPTZ** | **NULL** (added by migration 005) |

**State transition for `opened_at`**:
- Initial state: `NULL` (selection exists but patient has not opened it)
- Transition: `NULL → <timestamp>` — triggered by first successful `GET /api/v1/embryos` with patient token
- Terminal state: timestamp is immutable — subsequent patient accesses do NOT update it

### `access_tokens` (F-02, unchanged)

Relevant fields for F-04 response assembly:

| Column     | Type        | Notes                              |
|------------|-------------|------------------------------------|
| patient_id | UUID        | FK → patients(id)                  |
| expires_at | TIMESTAMPTZ | Used as `token_expires_at` in response |
| revoked_at | TIMESTAMPTZ | NULL = token is active             |

At most one active token per patient at any time (invariant maintained by `revokeByPatientId` on token issuance).

---

## TypeScript Types

### `PatientSelection` (extended)

```typescript
// apps/api/src/modules/auth/selection.repository.ts
export interface PatientSelection {
  id: string;
  patient_id: string;
  clinic_id: string;
  embryo_ids: string[];
  created_by: string;
  created_at: Date;
  updated_at: Date;
  opened_at: Date | null;   // NEW — F-04
}
```

### Response DTOs (coordinator-facing)

```typescript
// Patient list item — GET /api/v1/patients
interface PatientListItem {
  id: string;
  name: string | null;
  clinic_id: string;
  created_at: Date;
  selection: {
    opened_at: Date | null;
    token_expires_at: Date | null;
  } | null;
}

// Patient detail — GET /api/v1/patients/:id
interface PatientDetail {
  id: string;
  name: string | null;
  clinic_id: string;
  created_at: Date;
  selection: {
    embryo_ids: string[];
    opened_at: Date | null;
    token_expires_at: Date | null;
  } | null;
}
```

---

## Repository Methods (new / modified)

### `selection.repository.ts` — additions

```typescript
// Set opened_at on first patient access (idempotent)
export async function setOpenedAt(sql: Sql, selectionId: string): Promise<void>
// SQL: UPDATE patient_selections SET opened_at = NOW() WHERE id = $1 AND opened_at IS NULL
```

### `patient.repository.ts` — additions

```typescript
// Enriched list for coordinator: patient + selection state + active token expiry
export async function findEnrichedByClinic(
  sql: Sql,
  clinicId: string
): Promise<PatientListItem[]>
// SQL: patients LEFT JOIN patient_selections + scalar subquery for token_expires_at

// Enriched single patient for coordinator detail view
export async function findEnrichedById(
  sql: Sql,
  id: string,
  clinicId?: string  // undefined = admin (no clinic filter)
): Promise<PatientDetail | null>
// SQL: same pattern, WHERE p.id = $1 AND (clinicId IS NULL OR p.clinic_id = $2)
```

---

## Entity Relationships (F-04 read path)

```
patients (1) ──── (0..1) patient_selections
     │                        │
     │                        └── opened_at: Date | null  ← F-04 adds
     │
     └── (0..1) access_tokens [active only: revoked_at IS NULL AND expires_at > NOW()]
                    └── expires_at → token_expires_at in response
```
