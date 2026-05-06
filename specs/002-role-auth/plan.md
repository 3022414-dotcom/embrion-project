# Implementation Plan: F-02 — Authorization Layer

**Branch**: `002-role-auth` | **Date**: 2026-05-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-role-auth/spec.md`

## Summary

Implement the server-side authorization layer on top of F-01's Fastify monorepo. Delivers:
(1) four new PostgreSQL tables (`patients`, `patient_selections`, `access_tokens`,
`token_audit_log`) via migration 003; (2) a unified `onRequest` auth hook that validates
both coordinator JWTs (`@fastify/jwt`) and patient opaque tokens (DB lookup) — sets
`request.caller` context for all downstream middleware; (3) a `requireRole()` preHandler
factory that replaces four inline role checks currently embedded in `embryo.service.ts`;
(4) clinic isolation enforced at the repository layer via `clinic_id` from the JWT claim
(replaces the `"default-clinic"` stub); (5) patient selection scoping — `GET /embryos`
and `GET /embryos/:id` filtered to `embryo_ids[]` when caller is `patient`.

## Technical Context

**Language/Version**: TypeScript 5.4 (strict mode) — same as F-01
**Primary Dependencies**: `@fastify/jwt` 8.x (already installed), `postgres` 3.x (already
installed), Node.js built-in `crypto` (token generation — no new dependency)
**Storage**: PostgreSQL 16 — four new tables added via `003_auth_schema.sql`; existing
`embryos` and `embryo_status_log` tables unchanged
**Testing**: Vitest + Supertest integration tests with real PostgreSQL via testcontainers;
test JWTs signed with `signTestToken()` helper already in `apps/api/tests/helpers/auth.ts`
**Target Platform**: Linux server (Node.js 20 LTS) — same as F-01
**Project Type**: Web application — monorepo extension (backend API only for F-02)
**Performance Goals**: Token 401 response < 100 ms (SC-001); all existing embryo endpoint
p95 targets unchanged (< 200 ms per F-01); new auth endpoints (POST /patients,
POST /patients/:id/token, GET/PATCH /patients/:id/selection) expected under 200 ms p95
(single indexed DB query each) — formal load benchmarks deferred to post-launch monitoring
**Constraints**: No new npm packages required; `clinic_id` never sourced from request body
(always from JWT claim); patient token stored as raw hex (256-bit entropy — see research.md
Decision 2); F-03 owns coordinator/admin login and JWT issuance
**Scale/Scope**: Clinic-scale — same as F-01 (~1,000–10,000 embryos, hundreds of patients)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Code Quality | ✅ PASS | New `auth` module has single responsibility (token lifecycle + patient management); middleware extracted to `apps/api/src/middleware/` with single-purpose files; no logic duplication — `requireRole` factory replaces 4 identical inline checks |
| II. Testing Standards | ✅ PASS | TDD cycle enforced: tests written first, must fail, then implementation; real PostgreSQL via testcontainers for all DB-touching tests; `signTestToken()` helper provides real JWTs (not mocks) for coordinator/admin paths |
| III. UX Consistency | ✅ PASS (not applicable) | F-02 is API/data layer only — no user-facing UI surface introduced |
| IV. Performance | ✅ PASS | Token hot-path uses indexed `token_value` lookup (single B-tree scan); expiry check in SQL WHERE clause (no post-query filtering); JWT path has zero DB queries; SC-001 (< 100 ms) achievable |

**Post-design re-check**: ✅ All gates pass. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-role-auth/
├── plan.md                          # This file
├── research.md                      # Phase 0 — tech decisions and rationale
├── data-model.md                    # Phase 1 — table schemas, types, permissions matrix
├── contracts/
│   └── auth-api.yml                 # OpenAPI 3.1 — new auth endpoints
└── tasks.md                         # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code

```text
apps/api/src/
├── app.ts                           # MODIFY: register auth router; swap onRequest hook
├── middleware/                      # NEW directory
│   ├── auth-hook.ts                 # Unified onRequest: JWT → opaque token fallback
│   └── require-role.ts              # preHandler factory: requireRole(...roles)
├── modules/
│   ├── auth/                        # NEW module
│   │   ├── auth.router.ts           # /patients and /patients/:id/* endpoints
│   │   ├── auth.service.ts          # issueToken, revokeToken, validatePatientToken
│   │   ├── patient.repository.ts    # CRUD for patients table
│   │   ├── selection.repository.ts  # CRUD for patient_selections table
│   │   ├── token.repository.ts      # create, findActive, revoke for access_tokens
│   │   └── audit.repository.ts      # logEvent for token_audit_log
│   └── embryo/                      # MODIFY existing module
│       ├── embryo.router.ts         # Replace per-router onRequest hook; add requireRole
│       ├── embryo.service.ts        # Remove 4 inline role checks; accept clinicId param
│       └── embryo.repository.ts     # Add clinic_id filter to findAll, findById, create
└── db/
    └── migrations/
        └── 003_auth_schema.sql      # NEW: patients, patient_selections, access_tokens,
                                     #      token_audit_log tables

apps/api/tests/
├── helpers/
│   └── auth.ts                      # EXISTS — signTestToken already supports clinic_id
├── integration/
│   ├── auth-patient-token.test.ts   # NEW: US1 — patient token validation
│   ├── auth-coordinator.test.ts     # NEW: US2 — clinic isolation, selection management
│   ├── auth-admin.test.ts           # NEW: US3 — cross-clinic access
│   └── auth-middleware.test.ts      # NEW: role middleware, 401/403 matrix
└── unit/
    └── auth.service.test.ts         # NEW: token issuance, revocation, expiry logic
```

**Structure Decision**: Auth logic lives in `apps/api/src/modules/auth/` following the same
module pattern established in F-01 for `embryo/`. Middleware (auth-hook, require-role) lives
in a shared `apps/api/src/middleware/` directory — consumed by both `auth.router.ts` and
`embryo.router.ts`. No new workspace packages: auth types are API-internal for F-02 (unlike
the F-01 schema package shared with the frontend).

---

## Phase 1: Setup

**Purpose**: Create migration and scaffold new directories. No logic yet.

- [ ] T001 Create `apps/api/src/db/migrations/003_auth_schema.sql` — four tables as defined
      in `data-model.md`: `patients`, `patient_selections`, `access_tokens`,
      `token_audit_log` with all columns, constraints, CHECK clauses, and indexes.
- [ ] T002 Create `apps/api/src/middleware/` directory with empty placeholder files
      `auth-hook.ts` and `require-role.ts` (export stubs only — no logic).
- [ ] T003 Create `apps/api/src/modules/auth/` directory with empty placeholder files
      `auth.router.ts`, `auth.service.ts`, `patient.repository.ts`,
      `selection.repository.ts`, `token.repository.ts`, `audit.repository.ts`.
- [ ] T004 [P] Extend `FastifyRequest` augmentation in `apps/api/src/middleware/auth-hook.ts`
      — declare `caller?: CallerContext` type (replaces `jwtPayload?` from F-01); define
      `CallerContext` union type per data-model.md.

**Checkpoint**: `pnpm --filter @embrion/api build` succeeds (stubs compile, no logic errors).

---

## Phase 2: Foundation — Data Access + Auth Core (blocks all US work)

**Purpose**: Repositories, auth service, and middleware. All US work depends on this phase.

**⚠️ CRITICAL — TDD**: Write tests T005–T006 first, confirm they FAIL, then implement T007–T013.

### Tests — write first, must fail

- [ ] T005 [P] Write `apps/api/tests/unit/auth.service.test.ts` — unit tests for
      `auth.service.ts`: `issueToken` returns 64-char hex token; issuing new token revokes
      previous active token; `validatePatientToken` returns CallerContext for valid token;
      returns null for expired token; returns null for revoked token; `revokeToken` sets
      `revoked_at`. Must fail (no implementation).
- [ ] T006 [P] Write `apps/api/tests/integration/auth-middleware.test.ts` — integration
      tests for auth hook and role middleware: coordinator JWT → 200; patient opaque token →
      200 (patient-scoped); expired token → 401; missing token → 401; patient token on
      coordinator-only route → 403; wrong role → 403. Must fail.

### Implementation

- [ ] T007 Create `apps/api/src/modules/auth/patient.repository.ts` — `create(sql, { clinicId, name, createdBy })` → Patient; `findById(sql, id, clinicId?)` → Patient | null (clinicId filter for coordinator scope); `findByClinic(sql, clinicId)` → Patient[].
- [ ] T008 [P] Create `apps/api/src/modules/auth/selection.repository.ts` — `create(sql, { patientId, clinicId, createdBy })` → PatientSelection; `findByPatientId(sql, patientId)` → PatientSelection | null; `updateEmbryoIds(sql, patientId, embryoIds: string[])` → PatientSelection; validates all embryo IDs exist in `embryos` table with matching `clinic_id`.
- [ ] T009 [P] Create `apps/api/src/modules/auth/token.repository.ts` — `create(sql, { tokenValue, patientId, selectionId, clinicId, expiresAt, issuedBy })` → AccessToken; `findActive(sql, tokenValue)` → `{ token: AccessToken; embryoIds: string[] } | null` (joins patient_selections); `revokeByPatientId(sql, patientId, revokedBy)` — sets `revoked_at = NOW()` on all active tokens for patient.
- [ ] T010 [P] Create `apps/api/src/modules/auth/audit.repository.ts` — `logEvent(sql, { tokenId, event, actorId, actorRole, ipAddress })` — fire-and-forget insert into `token_audit_log`; never throws (failures are logged to stderr, not propagated).
- [ ] T011 Create `apps/api/src/modules/auth/auth.service.ts` — `issueToken(sql, { patientId, issuedBy, ttlDays, clinicId })`: validates selection exists; calls `revokeByPatientId` first; generates `crypto.randomBytes(32).toString('hex')`; inserts token; logs `issued` event. `validatePatientToken(sql, tokenValue, ipAddress)`: calls `findActive`; logs `used` on success, `expired_attempt` / `unauthorized_attempt` on failure; returns `CallerContext | null`. `revokeToken(sql, patientId, revokedBy)`: calls `revokeByPatientId`; logs `revoked` event.
- [ ] T012 Create `apps/api/src/middleware/require-role.ts` — `requireRole(...allowed: Role[])` returning Fastify `preHandlerHookHandler`; reads `request.caller.role`; returns 403 if not in allowed list.
- [ ] T013 Create `apps/api/src/middleware/auth-hook.ts` — `buildAuthHook(sql)` returning Fastify `onRequestHookHandler`; implements dual-path: (1) `jwtVerify()` → sets `request.caller` from JWT claims `{ sub, role, clinic_id }`; (2) JWT failure → calls `validatePatientToken(sql, token, ip)`; (3) both fail → 401.
- [ ] T014 Run T005 and T006 tests — must now pass. Fix until green.

**Checkpoint**: Auth core passes unit + middleware integration tests. Token issuance, validation, revocation, and role middleware all functional.

---

## Phase 3: User Story 1 — Patient accesses selection via token-link (Priority: P1)

**Goal**: Patient presents opaque token → sees only embryos in their selection.
**Independent Test**: Issue token for patient with 3-embryo selection → GET /embryos returns exactly 3 embryos → attempt GET /embryos/:id for embryo outside selection → 404.

### Tests — write first, must fail ⚠️

- [ ] T015 Write `apps/api/tests/integration/auth-patient-token.test.ts` — full US1
      scenarios: valid token → GET /embryos returns selection embryos only; expired token →
      401; revoked token → 401; GET /embryos/:id outside selection → 404; F-01 field
      projection applied (sex absent from patient response). Must fail.

### Implementation

- [ ] T016 Modify `apps/api/src/modules/embryo/embryo.repository.ts` — `findAll`:
      add optional `embryoIds?: string[]` param; when set, adds `AND id = ANY($n)` filter
      (patient scoping); `findById`: add optional `allowedIds?: string[]` param; when set,
      adds `AND id = ANY($n)` (returns null → 404 if embryo not in selection).
- [ ] T017 Modify `apps/api/src/modules/embryo/embryo.service.ts` — `list` and `getById`:
      accept `clinicId?: string` and `allowedEmbryoIds?: string[]`; pass to repository;
      **do not add any role check** — role enforcement is now entirely in middleware.
- [ ] T018 Modify `apps/api/src/modules/embryo/embryo.router.ts` — remove the per-router
      `onRequest` hook; replace with `app.addHook('onRequest', buildAuthHook(sql))` at the
      app level (in `app.ts`); GET routes extract `clinicId` and `embryoIds` from
      `request.caller` and pass to service.
- [ ] T019 Modify `apps/api/src/app.ts` — register `buildAuthHook(sql)` as global
      `onRequest` hook; register `authRouter` plugin alongside `embryoRouter`.
- [ ] T020 Run T015 tests — must pass. Fix until green.

**Checkpoint**: Patient token → GET /embryos returns exactly the selection. GET outside selection → 404. Expired/revoked token → 401. ✅ US1 independently testable.

---

## Phase 4: User Story 2 — Coordinator manages clinic data (Priority: P2)

**Goal**: Coordinator creates selections, issues tokens; all data scoped to their clinic.
**Independent Test**: Coordinator A and B in separate clinics; A cannot see B's patients or embryos (404); A's new embryo is not visible to B; token issued by A works only for A's patient.

### Tests — write first, must fail ⚠️

- [ ] T021 Write `apps/api/tests/integration/auth-coordinator.test.ts` — US2 scenarios:
      POST /patients creates patient in coordinator's clinic; GET /embryos with coordinator
      JWT returns only own clinic embryos; cross-clinic embryo request → 404; create
      selection → issue token → patient accesses correct embryos; patient token on POST
      /embryos → 403; coordinator POST /embryos still works (clinic_id from JWT, not body).
      Must fail.

### Implementation

- [ ] T022 Create `apps/api/src/modules/auth/auth.router.ts` — register routes:
      `POST /api/v1/patients` → `requireRole('coordinator', 'admin')` preHandler → calls
      `patient.repository.create`; `GET /api/v1/patients/:id/selection` → `requireRole(
      'coordinator', 'admin')`; `PATCH /api/v1/patients/:id/selection` → validate body,
      update embryo_ids; `POST /api/v1/patients/:id/token` → `requireRole('coordinator',
      'admin')` → calls `auth.service.issueToken`; `DELETE /api/v1/patients/:id/token` →
      calls `auth.service.revokeToken`; returns 204.
- [ ] T023 Modify `apps/api/src/modules/embryo/embryo.router.ts` — add `requireRole`
      preHandlers per permissions matrix in data-model.md: POST /embryos →
      `requireRole('coordinator','admin')`; PATCH /embryos/:id → same; PATCH
      /embryos/:id/status → same; POST /embryos/:id/delete → `requireRole('admin')`.
      Extract `clinicId` from `request.caller.clinic_id` for all write operations
      (replaces the `"default-clinic"` stub at line 79).
- [ ] T024 Modify `apps/api/src/modules/embryo/embryo.repository.ts` — `findAll`, `findById`:
      when `clinicId` is defined, add `AND clinic_id = $n` WHERE clause; `create`: stamp
      `clinic_id` from caller, never from request body.
- [ ] T025 Modify `apps/api/src/modules/embryo/embryo.service.ts` — remove all four inline
      role checks (`if (role === 'patient') throw ...`, `if (role !== 'admin') throw ...`);
      functions no longer receive `role` parameter — role enforcement is entirely in router
      preHandlers.
- [ ] T026 Run T021 tests — must pass. Fix until green.

**Checkpoint**: Coordinator JWT scoped to clinic. Cross-clinic → 404. Role middleware active on all embryo write routes. `"default-clinic"` stub gone. ✅ US2 independently testable.

---

## Phase 5: User Story 3 — Admin cross-clinic access (Priority: P3)

**Goal**: Admin bypasses clinic filter; can revoke tokens and manage users system-wide.
**Independent Test**: Admin JWT → GET /embryos returns all clinics' embryos; admin revokes Patient A's token from Clinic B; Clinic B coordinator cannot do the same.

### Tests — write first, must fail ⚠️

- [ ] T027 Write `apps/api/tests/integration/auth-admin.test.ts` — US3 scenarios: admin GET
      /embryos → embryos from multiple clinics returned; admin DELETE /patients/:id/token
      for patient in any clinic → 204; coordinator DELETE for patient in another clinic →
      404; admin POST /patients → patient created (admin has no clinic_id — use explicit
      body param). Must fail.
- [ ] T028 Modify `apps/api/src/modules/embryo/embryo.repository.ts` — confirm `findAll`
      and `findById` skip clinic filter when `clinicId` is `undefined` (admin path); verify
      existing behaviour — no new code needed if T024 implemented correctly.
- [ ] T029 Modify `apps/api/src/modules/auth/auth.router.ts` — for POST /patients when
      caller is admin: accept `clinic_id` from request body (coordinators use JWT claim);
      for DELETE /patients/:id/token: admin bypasses clinic ownership check.
- [ ] T030 Run T027 tests — must pass. Fix until green.

**Checkpoint**: Admin has cross-clinic access. Coordinator correctly restricted to own clinic for patient/token management. ✅ US3 independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, type correctness, CI pipeline integrity.

- [ ] T031 [P] Remove `jwtPayload?` from `FastifyRequest` augmentation in
      `apps/api/src/modules/embryo/embryo.router.ts` — replaced by `caller?` from
      `auth-hook.ts`; fix any remaining references across the codebase.
- [ ] T032 [P] Run `tsc --noEmit` across all workspaces — zero type errors. Pay attention
      to `Role` usage: `embryo.service.ts` no longer accepts `role` param.
- [ ] T033 [P] Update `apps/api/tests/helpers/auth.ts` — ensure `signTestToken` helper
      enforces `clinic_id` as required for `coordinator` role (was optional); add helper
      `signAdminToken()` for admin (no `clinic_id` needed).
- [ ] T034 Run full test suite: `pnpm test` — all tests green including F-01 regression tests.
- [ ] T035 [P] Verify SC-001: write a benchmark test asserting that a request with an
      expired token completes in < 100 ms end-to-end (token lookup + 401 response).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundation)**: Requires Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Requires Phase 2 complete
- **Phase 4 (US2)**: Requires Phase 2 complete; can run parallel with Phase 3 after Phase 2
- **Phase 5 (US3)**: Requires Phase 2 complete; can run parallel with US1 and US2
- **Phase 6 (Polish)**: Requires all desired user stories complete

### Within Each Phase

1. Write tests → confirm they FAIL
2. Implement → confirm tests PASS
3. Checkpoint validation before moving on

### Key Integration Points with F-01

| F-01 file | F-02 change |
|-----------|-------------|
| `embryo.router.ts` | Remove per-router `onRequest` hook; add `requireRole` preHandlers; fix `clinic_id` extraction |
| `embryo.service.ts` | Remove 4 role check throws; remove `role` param from 4 functions |
| `embryo.repository.ts` | Add `clinicId?` and `embryoIds?` filter params to `findAll`, `findById`; stamp `clinic_id` in `create` |
| `app.ts` | Register global auth hook; register auth router |
| `FastifyRequest` augmentation | Replace `jwtPayload?` with `caller?` (CallerContext) |

---

## Implementation Notes

- **No breaking change to F-01 API surface**: all existing embryo endpoints keep same paths
  and response shapes. Only auth requirements and clinic scoping are added.
- **`embryo.service.ts` becomes role-agnostic**: services are pure data functions after
  removing role checks. Role enforcement lives exclusively in HTTP middleware.
- **Admin has no `clinic_id`** in JWT: admin CallerContext has `clinic_id: undefined`;
  repository layer treats `undefined` as "no filter" (all clinics visible).
- **Token audit logging is fire-and-forget**: `audit.repository.logEvent` errors are caught
  and logged to stderr but never surface as HTTP errors — audit failure must not break
  the primary auth flow.
- **Test JWTs**: `signTestToken()` in `apps/api/tests/helpers/auth.ts` already supports
  `clinic_id` in payload — used by F-01 tests (`clinic_id: "clinic-create-test"`). No
  changes needed to produce valid coordinator tokens for F-02 tests.
