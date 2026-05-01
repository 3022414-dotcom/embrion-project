# Quickstart: F-01 — Embryo Data Model

**Target audience**: Backend and frontend developers working in the monorepo
**Date**: 2026-05-01

---

## Prerequisites

- Node.js 20 LTS
- pnpm 9.x (`npm install -g pnpm`)
- Docker (for PostgreSQL via testcontainers in integration tests)
- Git

---

## Repository Setup

```bash
# Clone and install all workspace dependencies
git clone <repo-url> embrion-project
cd embrion-project
pnpm install

# Build the schema package (required before running api or web)
pnpm --filter @embrion/schema build
```

---

## Monorepo Structure at a Glance

```
apps/api       → Fastify backend (depends on @embrion/schema)
apps/web       → React frontend (depends on @embrion/schema)
packages/schema → Canonical types + Zod schemas + role visibility (F-01 lives here)
```

---

## Working with the Schema Package

### Importing types in `apps/api`

```typescript
import {
  Embryo,
  EmbryoForPatient,
  EmbryoForCoordinator,
  projectEmbryo,
  EmbryoSchema,
} from "@embrion/schema";
```

### Importing types in `apps/web`

```typescript
import type { EmbryoForPatient } from "@embrion/schema";
```

---

## Key Files in `packages/schema/src/`

| File | Purpose |
|------|---------|
| `embryo.types.ts` | TypeScript type definitions for all entities |
| `embryo.schema.ts` | Zod schemas — runtime validation at storage boundary |
| `embryo.visibility.ts` | Role visibility matrix + `projectEmbryo(role, embryo)` fn |
| `embryo.manifest.ts` | Schema version manifest (`CURRENT_SCHEMA_VERSION`) |
| `index.ts` | Public barrel export |

---

## Running the Schema Package Tests (TDD)

Tests must be written **before** implementation and must fail first:

```bash
# Run schema unit tests in watch mode
pnpm --filter @embrion/schema test

# Run with coverage
pnpm --filter @embrion/schema test:coverage
```

Expected test files:
- `packages/schema/tests/embryo.schema.test.ts` — Zod validation rules
- `packages/schema/tests/embryo.visibility.test.ts` — Role matrix projection

---

## Running Integration Tests (real PostgreSQL)

```bash
# Requires Docker running
pnpm --filter @embrion/api test:integration
```

Testcontainers spins up a PostgreSQL 16 instance automatically — no manual DB setup needed.

---

## Updating the Schema (Bump Version)

1. Edit types in `packages/schema/src/embryo.types.ts`
2. Update Zod schema in `packages/schema/src/embryo.schema.ts`
3. Update role visibility matrix in `packages/schema/src/embryo.visibility.ts` if needed
4. Bump `CURRENT_SCHEMA_VERSION` in `packages/schema/src/embryo.manifest.ts`:
   - Breaking change (field removed / type changed) → bump MAJOR
   - New optional field → bump MINOR
   - Docs / constraint clarification → bump PATCH
5. Regenerate `contracts/embryo.schema.json`:
   ```bash
   pnpm --filter @embrion/schema generate:json-schema
   ```
6. Add a changelog entry to `embryo.manifest.ts`
7. Run all tests: `pnpm test`

---

## Adding a New Embryo Record (API)

```bash
curl -X POST http://localhost:3000/api/v1/embryos \
  -H "Authorization: Bearer <coordinator-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "egg_donor": { "age": 28, "blood_type": "A+", "height": 165,
                   "eye_color": "brown", "hair_color": "dark_brown" },
    "sperm_donor": { "age": 32, "blood_type": "O+", "height": 178,
                     "eye_color": "blue", "hair_color": "brown" },
    "genetics": { "screening_status": "passed", "chromosomal_abnormalities": false },
    "medical": { "quality_grade": "A", "development_stage": "blastocyst",
                 "freeze_date": "2026-01-15" },
    "media": { "donor_photo_available": false }
  }'
```

Note: `phenotype` fields are derived automatically if omitted. `meta.schema_version`
is set by the server to the current `CURRENT_SCHEMA_VERSION`.

---

## Checking Role Visibility Locally

```typescript
import { projectEmbryo } from "@embrion/schema";

const patientView = projectEmbryo("patient", fullEmbryoRecord);
// patientView.sex === undefined  ✓
// patientView.genetics.screening_status === "passed"  ✓
// patientView.genetics.chromosomal_abnormalities === undefined  ✓
```

---

## Schema Version Manifest Endpoint

```bash
curl http://localhost:3000/api/v1/schema/manifest \
  -H "Authorization: Bearer <any-token>"
# → { "version": "1.0.0", "effective_date": "2026-05-01", "changelog": [...] }
```
