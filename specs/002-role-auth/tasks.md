---
description: "Task list for F-02 — Authorization Layer"
---

# Tasks: F-02 — Authorization Layer

**Input**: Design documents from `specs/002-role-auth/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/ ✅, research.md ✅

**Tests**: Included — required by Constitution Principle II (TDD NON-NEGOTIABLE).
Tests MUST be written first and MUST fail before implementation begins.

**Organization**: Tasks are grouped by user story to enable independent delivery.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1, US2, US3)
- Exact file paths included in every task description

## Path Conventions (monorepo)

- Middleware: `apps/api/src/middleware/`
- Auth module: `apps/api/src/modules/auth/`
- Embryo module: `apps/api/src/modules/embryo/`
- Migrations: `apps/api/src/db/migrations/`
- Integration tests: `apps/api/tests/integration/`
- Unit tests: `apps/api/tests/unit/`
- Test helpers: `apps/api/tests/helpers/`

---

## Phase 1: Setup

**Purpose**: Migration, directory scaffolding, type declarations. No business logic yet.

- [ ] T001 Create `apps/api/src/db/migrations/003_auth_schema.sql` — four tables per
      `data-model.md`: `patients` (id, clinic_id, name, created_by, created_at),
      `patient_selections` (id, patient_id UNIQUE FK, clinic_id, embryo_ids UUID[],
      created_by, created_at, updated_at), `access_tokens` (id, token_value UNIQUE,
      patient_id FK, selection_id FK, clinic_id, expires_at, issued_by, issued_at,
      revoked_at, revoked_by, CHECK constraint), `token_audit_log` (id, token_id nullable FK,
      event CHECK constraint with 6 values, actor_id, actor_role, occurred_at, ip_address);
      all indexes from data-model.md included.
- [ ] T002 [P] Create `apps/api/src/middleware/auth-hook.ts` — stub only: export empty
      `buildAuthHook` function and `CallerContext` union type as defined in data-model.md
      (`{ role: 'coordinator'|'admin'; sub: string; clinic_id: string }` |
      `{ role: 'patient'; sub: string; clinic_id: string; selection_id: string; embryo_ids: string[] }`);
      add `caller?: CallerContext` to `FastifyRequest` augmentation.
- [ ] T003 [P] Create `apps/api/src/middleware/require-role.ts` — stub only: export empty
      `requireRole` function signature `(...allowed: Role[]) => preHandlerHookHandler`.
- [ ] T004 [P] Scaffold `apps/api/src/modules/auth/` — create six empty stub files:
      `auth.router.ts`, `auth.service.ts`, `patient.repository.ts`,
      `selection.repository.ts`, `token.repository.ts`, `audit.repository.ts`
      (each exports only its main function signatures, no implementation).

**Checkpoint**: `pnpm --filter @embrion/api build` succeeds — stubs compile, zero type errors.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: All repositories, auth service, and middleware. Every user story depends on this phase.

**⚠️ CRITICAL**: Write tests T005–T006 first, confirm they FAIL, then implement T007–T013.

### Tests — write first, must fail

- [ ] T005 [P] Write `apps/api/tests/unit/auth.service.test.ts` — unit tests for
      `auth.service.ts`: (a) `issueToken` returns a 64-char hex string; (b) `issueToken`
      called twice for the same patient revokes the first token before issuing the second;
      (c) `validatePatientToken` returns CallerContext for a valid non-expired token;
      (d) `validatePatientToken` returns null and logs `expired_attempt` for an expired
      token; (e) `validatePatientToken` returns null and logs `unauthorized_attempt` for an
      unknown token string; (f) `revokeToken` sets `revoked_at` immediately. Must fail.
- [ ] T006 [P] Write `apps/api/tests/integration/auth-middleware.test.ts` — integration
      tests for the unified auth hook and role middleware: (a) valid coordinator JWT →
      request.caller populated, 200 on embryo GET; (b) valid patient opaque token →
      request.caller populated with role=patient; (c) expired JWT → 401; (d) missing
      Authorization header → 401; (e) patient token presented on a coordinator-only route
      → 403; (f) coordinator token on admin-only route → 403; (g) malformed token string
      → 401. Must fail.

### Implementation

- [ ] T007 Create `apps/api/src/modules/auth/patient.repository.ts` —
      `create(sql, { clinicId, name?, createdBy })` → `Patient`;
      `findById(sql, id, clinicId?: string)` → `Patient | null` (if `clinicId` provided,
      adds `AND clinic_id = $2` — coordinator scope; omit for admin);
      `findByClinic(sql, clinicId)` → `Patient[]`.
- [ ] T008 [P] Create `apps/api/src/modules/auth/selection.repository.ts` —
      `create(sql, { patientId, clinicId, createdBy })` → `PatientSelection`;
      `findByPatientId(sql, patientId)` → `PatientSelection | null`;
      `updateEmbryoIds(sql, patientId, embryoIds: string[])` → `PatientSelection`;
      validate all `embryoIds` exist in `embryos` table with matching `clinic_id` before
      updating; throw 400-coded error if any ID is invalid.
- [ ] T009 [P] Create `apps/api/src/modules/auth/token.repository.ts` —
      `create(sql, { tokenValue, patientId, selectionId, clinicId, expiresAt, issuedBy })` → `AccessToken`;
      `findActive(sql, tokenValue)` → `{ token: AccessToken; embryoIds: string[] } | null`
      (JOIN patient_selections for embryo_ids; WHERE token_value = $1 AND revoked_at IS NULL
      AND expires_at > NOW());
      `findByTokenValue(sql, tokenValue)` → `AccessToken | null` (no active filter — for
      expiry check in audit logging);
      `revokeByPatientId(sql, patientId, revokedBy)` — UPDATE access_tokens SET
      revoked_at = NOW(), revoked_by = $2 WHERE patient_id = $1 AND revoked_at IS NULL.
- [ ] T010 [P] Create `apps/api/src/modules/auth/audit.repository.ts` —
      `logEvent(sql, { tokenId?: string; event: AuditEvent; actorId?: string; actorRole?: string; ipAddress?: string })` — INSERT into `token_audit_log`; wrapped in try/catch;
      errors logged to `console.error` but never thrown (fire-and-forget).
- [ ] T011 Create `apps/api/src/modules/auth/auth.service.ts` — depends on T007–T010:
      `issueToken(sql, { patientId, issuedBy, ttlDays: number, clinicId })`:
      verify `findByPatientId` returns a selection (throw 400 if none);
      call `revokeByPatientId` first; generate token via `crypto.randomBytes(32).toString('hex')`;
      call `token.repository.create`; call `audit.logEvent('issued')`;
      return `{ tokenValue, expiresAt }`.
      `validatePatientToken(sql, tokenValue, ipAddress?)`:
      call `findActive` → if found log `used`, return CallerContext;
      call `findByTokenValue` → if found (but inactive/expired) log `expired_attempt`, return null;
      else log `unauthorized_attempt`, return null.
      `revokeToken(sql, patientId, revokedBy)`:
      call `revokeByPatientId`; call `audit.logEvent('revoked')`.
- [ ] T012 [P] Implement `apps/api/src/middleware/require-role.ts` — replace stub:
      `requireRole(...allowed: Role[])` returns a Fastify `preHandlerHookHandler` that reads
      `request.caller?.role`; returns `reply.status(403).send({ error: 'Forbidden' })` if
      role absent or not in `allowed` list.
- [ ] T013 Implement `apps/api/src/middleware/auth-hook.ts` — replace stub:
      `buildAuthHook(sql: Sql)` returns Fastify `onRequestHookHandler`; (1) extract Bearer
      token from Authorization header → missing → 401; (2) attempt `request.jwtVerify()` →
      on success set `request.caller` from JWT claims `{ sub, role, clinic_id }`; (3) on
      JWT failure: call `auth.service.validatePatientToken(sql, token, ip)` → found: set
      `request.caller`; not found: return 401 `{ error: 'Unauthorized' }`. Depends on T011.
- [ ] T014 Run T005 and T006 tests — must now pass. Fix until fully green before proceeding.

**Checkpoint**: Auth core functional — token issuance/validation/revocation, role middleware, and unified auth hook all tested. ✅

---

## Phase 3: User Story 1 — Patient accesses selection via token-link (Priority: P1) 🎯 MVP

**Goal**: Patient presents opaque token → sees only the embryos in their doctor-curated selection. All F-01 field projections still applied.
**Independent Test**: Issue a token for a patient with a 3-embryo selection → `GET /api/v1/embryos` returns exactly those 3 embryos → `GET /api/v1/embryos/:id` for an embryo outside the selection → 404 → expire the token → retry any request → 401.

### Tests for US1 — write first, must fail ⚠️

- [ ] T015 Write `apps/api/tests/integration/auth-patient-token.test.ts` — US1 scenarios:
      (a) valid patient token → `GET /api/v1/embryos` returns only selection embryos (assert
      count and IDs); (b) `GET /api/v1/embryos/:id` for embryo in selection → 200 with
      patient-projected fields (sex absent per F-01 visibility matrix); (c) `GET /api/v1/embryos/:id`
      for embryo NOT in selection → 404; (d) expired token → 401 with expiry reason; (e)
      revoked token → 401; (f) concurrent requests with same valid token → both 200 (multi-use). Must fail.

### Implementation for US1

- [ ] T016 [P] [US1] Modify `apps/api/src/modules/embryo/embryo.repository.ts` —
      `findAll`: add optional `embryoIds?: string[]` param; when provided add
      `AND id = ANY($n::uuid[])` filter; `findById`: add optional `allowedIds?: string[]`
      param; when provided add `AND id = ANY($n::uuid[])` — returns null if embryo exists
      but not in list (caller gets 404).
- [ ] T017 [P] [US1] Modify `apps/api/src/modules/embryo/embryo.service.ts` —
      `list` and `getById`: add `clinicId?: string` and `allowedEmbryoIds?: string[]`
      parameters; pass both to repository calls; **remove the `role` parameter from these
      two functions** — role enforcement moves to middleware.
- [ ] T018 [US1] Modify `apps/api/src/modules/embryo/embryo.router.ts` —
      remove the `app.addHook('onRequest', ...)` block entirely (auth moves to app level);
      in `GET /api/v1/embryos` handler: read `clinicId` and `embryoIds` from
      `request.caller` (undefined for coordinator/admin → no filter; embryo_ids for patient);
      in `GET /api/v1/embryos/:id` handler: same — pass `allowedIds` only when
      `request.caller.role === 'patient'`.
- [ ] T019 [US1] Modify `apps/api/src/app.ts` — register `buildAuthHook(sql)` as global
      `onRequest` hook (before router registration); register `authRouter` plugin alongside
      `embryoRouter` so patient management endpoints are available.
- [ ] T020 [US1] Run T015 tests — must pass. Fix until fully green.

**Checkpoint**: Patient token → exactly the selection embryos visible. Outside-selection ID → 404. Expired/revoked → 401. ✅ US1 independently testable.

---

## Phase 4: User Story 2 — Coordinator manages clinic data (Priority: P2)

**Goal**: Coordinator creates patients and selections, issues tokens. All data scoped to coordinator's clinic — cross-clinic attempts return 404. Role middleware active on all write routes.
**Independent Test**: Two clinics, one coordinator each → Coordinator A creates patient, selection (3 embryos), issues token → Coordinator A cannot read Clinic B embryos (404) → token issued by A works for patient seeing A's selection → `POST /api/v1/embryos` with patient token → 403.

### Tests for US2 — write first, must fail ⚠️

- [ ] T021 Write `apps/api/tests/integration/auth-coordinator.test.ts` — US2 scenarios:
      (a) `POST /api/v1/patients` with coordinator JWT → 201, patient has coordinator's
      clinic_id; (b) `GET /api/v1/embryos` with coordinator JWT → returns only own clinic
      embryos; (c) `GET /api/v1/embryos/:id` for embryo in another clinic → 404; (d) create
      patient → `PATCH /api/v1/patients/:id/selection` → `POST /api/v1/patients/:id/token`
      → patient token works for that selection; (e) `POST /api/v1/embryos` with patient
      token → 403; (f) `POST /api/v1/embryos` with coordinator JWT → 201 with clinic_id
      stamped from JWT (not from request body). Must fail.

### Implementation for US2

- [ ] T022 [US2] Create `apps/api/src/modules/auth/auth.router.ts` — register five routes,
      all behind `requireRole('coordinator', 'admin')` preHandler (except where noted):
      `POST /api/v1/patients` → validate body, call `patient.repository.create` with
      `clinicId` from `request.caller.clinic_id`;
      `GET /api/v1/patients/:id/selection` → call `selection.repository.findByPatientId`;
      return 404 if not found;
      `PATCH /api/v1/patients/:id/selection` → validate `embryo_ids` array in body; call
      `selection.repository.updateEmbryoIds` (creates if not exists);
      `POST /api/v1/patients/:id/token` → validate `ttl_days` (1–365, default 30); call
      `auth.service.issueToken`; return 201 with token_value and expires_at;
      `DELETE /api/v1/patients/:id/token` → call `auth.service.revokeToken`; return 204
      (idempotent — 204 even if no active token).
- [ ] T023 [US2] Modify `apps/api/src/modules/embryo/embryo.router.ts` — add `preHandler`
      per permissions matrix: `POST /api/v1/embryos` → `requireRole('coordinator','admin')`;
      `PATCH /api/v1/embryos/:id` → `requireRole('coordinator','admin')`;
      `PATCH /api/v1/embryos/:id/status` → `requireRole('coordinator','admin')`;
      `POST /api/v1/embryos/:id/delete` → `requireRole('admin')`;
      in `POST /api/v1/embryos` handler: extract `clinicId` from `request.caller.clinic_id`
      (replaces the `?? "default-clinic"` stub on line 79 of current embryo.router.ts).
- [ ] T024 [P] [US2] Modify `apps/api/src/modules/embryo/embryo.repository.ts` —
      `findAll(sql, { clinicId?, status?, include_deleted })`: add `AND clinic_id = $n` when
      `clinicId` defined; `findById(sql, id, clinicId?)`: add `AND clinic_id = $n` when
      defined (returns null → coordinator gets 404);
      `create(sql, payload, clinicId)`: always sets `clinic_id = clinicId` column from
      parameter — never reads clinic_id from payload.
- [ ] T025 [US2] Modify `apps/api/src/modules/embryo/embryo.service.ts` — remove all four
      inline role checks: `if (role === 'patient') throw ...` in `createRecord`,
      `changeStatus`, `updateRecord`; `if (role !== 'admin') throw ...` in `softDelete`;
      remove `role: Role` parameter from `createRecord`, `changeStatus`, `updateRecord`,
      `softDelete`; functions are now role-agnostic — enforcement is entirely in router
      preHandlers (T023).
- [ ] T026 [US2] Run T021 tests — must pass. Fix until fully green.

**Checkpoint**: Coordinator JWT scoped to clinic. `"default-clinic"` stub removed. Role middleware on all embryo write routes. ✅ US2 independently testable.

---

## Phase 5: User Story 3 — Admin manages users across clinics (Priority: P3)

**Goal**: Admin bypasses clinic filter (sees all clinics). Admin can revoke any patient's token regardless of clinic. Coordinators cannot act outside their own clinic.
**Independent Test**: Create embryos in Clinic A and Clinic B → Admin JWT → `GET /api/v1/embryos` returns both → Admin `DELETE /api/v1/patients/:id/token` for Clinic B patient → 204 → Clinic A coordinator same call on Clinic B patient → 404.

### Tests for US3 — write first, must fail ⚠️

- [ ] T027 Write `apps/api/tests/integration/auth-admin.test.ts` — US3 scenarios:
      (a) admin JWT → `GET /api/v1/embryos` → embryos from both clinic fixtures returned;
      (b) admin `DELETE /api/v1/patients/:id/token` for patient in any clinic → 204;
      (c) coordinator `DELETE /api/v1/patients/:id/token` for patient in another clinic → 404;
      (d) admin `POST /api/v1/patients` with `clinic_id` in body → 201 patient created in
      specified clinic; (e) coordinator token on `POST /api/v1/embryos/:id/delete` → 403;
      (f) admin token on `POST /api/v1/embryos/:id/delete` → 204. Must fail.

### Implementation for US3

- [ ] T028 [P] [US3] Verify `apps/api/src/modules/embryo/embryo.repository.ts` — confirm
      that `findAll` and `findById` skip the clinic_id filter when `clinicId` is `undefined`
      (the admin path). No new code should be needed if T024 implemented correctly; add a
      targeted integration test assertion if the behaviour is unclear.
- [ ] T029 [US3] Modify `apps/api/src/modules/auth/auth.router.ts` — two admin-specific
      adjustments: (1) `POST /api/v1/patients` when `request.caller.role === 'admin'`: accept
      `clinic_id` from request body (admin has no JWT clinic_id); (2) patient ownership
      check in `GET/PATCH /patients/:id/selection`, `POST/DELETE /patients/:id/token`: for
      coordinator, verify `patient.clinic_id === request.caller.clinic_id` → 404 if
      mismatch; for admin, skip clinic check.
- [ ] T030 [US3] Run T027 tests — must pass. Fix until fully green.

**Checkpoint**: Admin has cross-clinic read/write. Coordinator correctly blocked from other clinics' patient records. ✅ US3 independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Type cleanup, regression safety, performance validation.

- [ ] T031 [P] Remove `jwtPayload?` from `FastifyRequest` augmentation in
      `apps/api/src/modules/embryo/embryo.router.ts` — replaced by `caller?` declared in
      `apps/api/src/middleware/auth-hook.ts`; search entire `apps/api/src/` for remaining
      references to `request.jwtPayload` and update to `request.caller`.
- [ ] T032 [P] Update `apps/api/tests/helpers/auth.ts` — make `clinic_id` required when
      `role === 'coordinator'` in `signTestToken`; add `signAdminToken(secret)` helper that
      omits `clinic_id`; update any existing F-01 test files that use `signTestToken` to
      pass the explicit `clinic_id` they already use.
- [ ] T033 [P] Run `tsc --noEmit` across all workspaces (`pnpm -r exec tsc --noEmit`) —
      zero type errors required; pay special attention to `embryo.service.ts` functions that
      no longer accept a `role` parameter and callers in `embryo.router.ts`.
- [ ] T034 Run full test suite: `pnpm test` — all tests green including all F-01 regression
      tests (`embryo-get`, `embryo-patient-projection`, `embryo-status`, `embryo-delete`,
      `embryo-validation`, `embryo-create`, `embryo-update`).
- [ ] T035 [P] Write SC-001 benchmark assertion in `apps/api/tests/integration/auth-middleware.test.ts`
      — add a test that presents an expired token and asserts total response time < 100 ms
      (use `performance.now()` before/after the Supertest call).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Requires Phase 1 complete — **BLOCKS all user stories**
- **US1 (Phase 3)**: Requires Phase 2 complete
- **US2 (Phase 4)**: Requires Phase 2 complete; can run in parallel with US1 after Phase 2
- **US3 (Phase 5)**: Requires Phase 2 complete; can run in parallel with US1 and US2
- **Polish (Phase 6)**: Requires all desired user stories complete

### Within Each User Story

1. Write tests (T0XX) → confirm they **FAIL**
2. Implement (T0XX) → confirm tests **PASS**
3. Checkpoint validation before moving to next story

### Key F-01 Integration Points

| F-01 file | F-02 change | Task |
|-----------|-------------|------|
| `embryo.router.ts` | Remove per-router `onRequest`; add `requireRole` preHandlers; fix `clinic_id` | T018, T023 |
| `embryo.service.ts` | Remove 4 inline role check throws; remove `role` param from 4 functions | T025 |
| `embryo.repository.ts` | Add `clinicId?` and `embryoIds?` filter params | T016, T024 |
| `app.ts` | Register global auth hook; register auth router | T019 |
| `FastifyRequest` augmentation | Replace `jwtPayload?` with `caller?` | T002, T031 |

### Parallel Opportunities

```bash
# Phase 1 — all [P] tasks in parallel
T002, T003, T004  # scaffold middleware/ and auth/ stubs simultaneously

# Phase 2 — tests first (parallel), then implementation (parallel where marked)
T005, T006  # write both test files in parallel (must fail)
# then:
T007        # patient.repository (no internal deps)
T008, T009, T010  # selection, token, audit repositories in parallel
T011        # auth.service (depends on T007-T010)
T012        # require-role (no deps beyond T003 stub)
T013        # auth-hook (depends on T011)

# Phase 3 + 4 + 5 — all three user stories after Phase 2
T015  # US1 test
T016, T017  # US1 repository + service mods in parallel
# then T018, T019, T020

T021  # US2 test (concurrent with T015 if separate developer)
T022  # US2 auth.router
T023, T024  # US2 router preHandlers + repo clinic filter in parallel
# then T025, T026

T027  # US3 test (concurrent with US1/US2)
T028, T029  # US3 verify + adjust in parallel
# then T030
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — CRITICAL, blocks everything
3. Complete Phase 3: US1 (Patient token-link access)
4. **STOP and VALIDATE**: patient token → correct embryos visible; expired → 401
5. Coordinator can still use all F-01 endpoints (auth hook handles JWT transparently)

### Incremental Delivery

1. Phase 1 + 2 → Auth foundation ready
2. Phase 3 → US1: patients can access their selections ✅
3. Phase 4 → US2: coordinators manage selections per-clinic; role middleware active ✅
4. Phase 5 → US3: admin has cross-clinic access ✅
5. Phase 6 → Production-ready ✅

### Parallel Team Strategy (2+ developers after Phase 2)

- Developer A: US1 (Phase 3) — embryo repo/service/router modifications
- Developer B: US2 (Phase 4) — auth router (patient/selection/token endpoints)
- Developer C: US3 (Phase 5) — admin bypass + cross-clinic token revoke

---

## Notes

- `[P]` tasks = different files, no dependency on incomplete tasks in same phase
- Tests marked ⚠️ MUST be written first and MUST fail (Constitution Principle II)
- F-01 regression tests MUST remain green throughout — verify after each phase
- `embryo.service.ts` becomes fully role-agnostic after T025 — services are pure data functions
- Admin path: `clinic_id` is `undefined` in CallerContext → repository skips clinic filter automatically
- Token audit logging is fire-and-forget — failures must never surface as HTTP errors (T010)
- `signTestToken()` already supports `clinic_id` (used in F-01 tests) — no new test infrastructure needed
