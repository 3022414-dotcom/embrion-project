# Tasks: F-03 — Coordinator and Admin Authentication

**Input**: Design documents from `specs/003-coordinator-auth/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/login-api.yml ✅

**TDD approach**: Test tasks are included per plan.md — write tests first, confirm they fail, then implement.

---

## Phase 1: Setup

**Purpose**: Install dependency, create migration, scaffold stub files. No business logic.

- [ ] T001 Install `bcryptjs` and `@types/bcryptjs` — run `pnpm --filter @embrion/api add bcryptjs` and `pnpm --filter @embrion/api add -D @types/bcryptjs`
- [ ] T002 Create `apps/api/src/db/migrations/004_users.sql` — `users` table (id, email, password_hash, role, clinic_id, is_active, created_at, CHECK constraint enforcing clinic_id presence for coordinator and absence for admin) and `login_attempts` table (id, email, occurred_at) with indexes as defined in `data-model.md`
- [ ] T003 [P] Create stub files with export stubs only (no logic) in `apps/api/src/modules/auth/`: `user.repository.ts`, `login-attempt.repository.ts`, `login.service.ts`, `login.router.ts`

**Checkpoint**: `pnpm --filter @embrion/api build` succeeds with no type errors.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Repositories, login service, and auth-hook modification. All user story phases depend on this.

**⚠️ CRITICAL — TDD**: Write T004–T005 first, confirm they FAIL, then implement T006–T009, then run T010.

### Tests — write first, must fail

- [ ] T004 [P] Write `apps/api/tests/unit/login.service.test.ts` — unit tests for `login()`: correct credentials → `{ status: 'ok', token }`; unknown email → `{ status: 'invalid' }`; wrong password → `{ status: 'invalid' }`; inactive account → `{ status: 'inactive' }`; 5 prior failures → `{ status: 'rate_limited', retryAfterSeconds: N }`; success clears failed-attempt counter. Must fail before implementation.
- [ ] T005 [P] Write initial `apps/api/tests/integration/auth-deactivation.test.ts` — auth-hook level: coordinator JWT with valid `sub` → 200; same JWT after direct SQL `UPDATE users SET is_active = false WHERE id = $1` → 401. Must fail before implementation.

### Implementation

- [ ] T006 Create `apps/api/src/modules/auth/user.repository.ts` — export `findByEmail(sql, email: string): Promise<User | null>` (normalise to lowercase, query `users`); `findById(sql, id: string): Promise<{ isActive: boolean } | null>` (single indexed query by UUID). Use `User` and `UserActiveStatus` types from `data-model.md`.
- [ ] T007 [P] Create `apps/api/src/modules/auth/login-attempt.repository.ts` — export `countRecent(sql, email: string, windowMinutes: number): Promise<number>` (COUNT with `occurred_at > NOW() - $2 * INTERVAL '1 minute'`); `record(sql, email: string): Promise<void>` (INSERT one row); `clearByEmail(sql, email: string): Promise<void>` (DELETE all rows for email — called on successful login per FR-011)
- [ ] T008 [P] Create `apps/api/src/modules/auth/login.service.ts` — export `login(sql, opts: { email: string; password: string; sign: SignFn }): Promise<LoginResult>` implementing the 8-step sequence from plan.md Phase 2: (1) normalise email; (2) countRecent → 429 if ≥ 5; (3) findByEmail → 401 + record if null; (4) check isActive → 401 if false; (5) bcrypt.compare → 401 + record if false; (6) clearByEmail; (7) build JWT payload `{ sub, role, clinic_id? }`; (8) sign + return token. Export `LoginResult` and `SignFn` types.
- [ ] T009 Modify `apps/api/src/middleware/auth-hook.ts` — in the JWT success branch, after `request.caller` is set from JWT claims, add: import `findById` from `../modules/auth/user.repository.js`; call `findById(sql, claims.sub)`; return `reply.status(401).send({ error: 'Unauthorized' })` if result is null or `!result.isActive`. The `sql` instance is available via the existing `buildAuthHook(sql)` closure.
- [ ] T010 Run `apps/api/tests/unit/login.service.test.ts` and `apps/api/tests/integration/auth-deactivation.test.ts` — both must now pass. Fix until green.

**Checkpoint**: Login service handles all credential/rate-limit scenarios. `is_active = false` → 401 on coordinator/admin JWT path. Foundation complete — user story phases can proceed.

---

## Phase 3: User Story 1 — Coordinator Logs In (Priority: P1) 🎯 MVP

**Goal**: `POST /api/v1/auth/login` issues a valid JWT for active coordinator and admin accounts.

**Independent Test**: POST correct coordinator credentials → 200 `{ token }` with `role: "coordinator"` and `clinic_id`; use token on `GET /api/v1/embryos` → 200. POST correct admin credentials → JWT with `role: "admin"`, no `clinic_id`. POST wrong password or unknown email → 401 with identical body.

### Tests — write first, must fail ⚠️

- [ ] T011 [P] [US1] Write `apps/api/tests/integration/auth-login.test.ts` — scenarios per contracts/login-api.yml and spec US1: coordinator login → 200 `{ token }` with correct claims; admin login → 200 `{ token }` with no `clinic_id`; JWT `exp` claim is 8 hours from `iat`; JWT accepted by `GET /api/v1/embryos` → 200; wrong password → 401 `{ error: "Invalid credentials" }`; unknown email → 401 same body; inactive account → 401 same body; missing `email` field → 400; missing `password` field → 400. Must fail before implementation.

### Implementation

- [ ] T012 [US1] Create `apps/api/src/modules/auth/login.router.ts` — register `POST /api/v1/auth/login` with no auth preHandler (public endpoint); validate body: `email` non-empty string + `password` non-empty string → 400 if missing; call `loginService.login(sql, { email, password, sign: request.server.jwt.sign.bind(request.server.jwt) })`; map `LoginResult` to HTTP responses per research Decision 7: `ok` → 200 `{ token }`, `invalid` / `inactive` → 401 `{ error: "Invalid credentials" }`, `rate_limited` → 429 `{ error: "Too many attempts", retry_after_seconds: N }`
- [ ] T013 [US1] Modify `apps/api/src/app.ts` — import `loginRouter` from `./modules/auth/login.router.js`; register with `await app.register(loginRouter, { sql: opts.sql })` alongside existing `embryoRouter` and `authRouter`
- [ ] T014 [US1] Run `apps/api/tests/integration/auth-login.test.ts` — must pass. Fix until green.

**Checkpoint**: Login endpoint functional. Coordinator and admin obtain JWT. JWT accepted by F-02 middleware. ✅ US1 independently testable.

---

## Phase 4: User Story 2 — Immediate Account Deactivation (Priority: P2)

**Goal**: Setting `is_active = false` invalidates all subsequent requests for that account's JWT with no grace period.

**Independent Test**: Coordinator logs in → receives JWT → direct SQL deactivates account → same JWT on `GET /api/v1/embryos` → 401. Re-enable account → coordinator must log in again (old JWT rejected by `is_active` check; fresh login → 200).

### Tests — write first, must fail ⚠️

- [ ] T015 [P] [US2] Complete `apps/api/tests/integration/auth-deactivation.test.ts` — add end-to-end scenarios: `POST /auth/login` → get JWT → `UPDATE users SET is_active = false` → `GET /api/v1/embryos` with JWT → 401; `UPDATE users SET is_active = true` → `POST /auth/login` again → new JWT → `GET /api/v1/embryos` → 200; inactive account `POST /auth/login` → 401 `{ error: "Invalid credentials" }`. Must fail before T009 is complete; re-run here for final end-to-end validation.
- [ ] T016 [US2] Run `apps/api/tests/integration/auth-deactivation.test.ts` full suite — must pass. Implementation was completed in T009; fix any gaps until green.

**Checkpoint**: Deactivation takes effect on next request. Re-enable requires fresh login. ✅ US2 independently testable.

---

## Phase 5: User Story 3 — Brute-Force Rate Limiting (Priority: P3)

**Goal**: 5 failed login attempts within 15 minutes → 429 with `retry_after_seconds` for all subsequent attempts including correct password.

**Independent Test**: 5 × POST wrong password for email A → 6th attempt (correct password) → 429 with `retry_after_seconds > 0`. Email B unaffected throughout. Successful login resets counter: attempt after success → 200.

### Tests — write first, must fail ⚠️

- [ ] T017 [P] [US3] Write `apps/api/tests/integration/auth-rate-limit.test.ts` — scenarios per spec US3: 5 failed attempts → 6th returns 429; 6th attempt with correct password → still 429; `retry_after_seconds` is a positive integer; different email unaffected; successful login resets counter (fail ×4, succeed ×1, fail ×1 → 200 not 429); 429 body matches schema from contracts/login-api.yml. Must fail before T008 is complete; re-run here.
- [ ] T018 [US3] Run `apps/api/tests/integration/auth-rate-limit.test.ts` — must pass. Implementation was completed in T008; fix any gaps until green.

**Checkpoint**: Rate limiting active per email. 429 includes `retry_after_seconds`. Successful login resets counter. ✅ US3 independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Dev seed, F-02 compatibility, type safety, full regression.

- [ ] T019 Create `apps/api/src/db/scripts/seed.ts` — import `bcryptjs` and `postgres`; read `DATABASE_URL` from `process.env` (exit with error if missing); hash `password123` at cost 12 for both accounts; `INSERT INTO users (id, email, password_hash, role, clinic_id, is_active) VALUES (...) ON CONFLICT (email) DO NOTHING` for coordinator (`coordinator@clinic.test`, `clinic-001`) and admin (`admin@clinic.test`, NULL); log `seeded` or `skipped (already exists)` per account; exit 0. Verify idempotency by running the script twice.
- [ ] T020 [P] Update all F-02 integration tests that use coordinator/admin JWTs — add `beforeAll` that inserts a `users` row (via direct `sql` query) matching each test file's JWT `sub` value(s) with `is_active = true`, and `afterAll` that deletes it. Required because T009 queries `users` on every coordinator/admin request. Files to update (11 total): `auth-coordinator.test.ts`, `auth-admin.test.ts`, `auth-middleware.test.ts`, `auth-patient-token.test.ts`, `embryo-create.test.ts`, `embryo-delete.test.ts`, `embryo-get.test.ts`, `embryo-patient-projection.test.ts`, `embryo-status.test.ts`, `embryo-update.test.ts`, `embryo-validation.test.ts`. Note: each file may use different `sub` strings — check `signCoordinatorToken` / `signAdminToken` / `signTestToken` calls in each file to find the exact values.
- [ ] T021 [P] Update `apps/api/tests/integration/auth-route-coverage.test.ts` for F-03 compatibility — two changes: (1) add `join(__dirname, "../../src/db/migrations/004_users.sql")` to the `MIGRATIONS` array so the `users` table exists in the test container; (2) add `["POST", "/api/v1/auth/login"]` to the `PUBLIC_ROUTES` array with an inline comment `// truly public — no auth header required` and add it to the skip condition in the 3rd test (`if (url === "/api/v1/schema/manifest" || url === "/api/v1/auth/login") continue`). This satisfies SC-005: the login route is explicitly accounted for in the coverage matrix.
- [ ] T022 [P] Run `pnpm --filter @embrion/api typecheck` (`tsc --noEmit`) — zero type errors. Verify `SignFn` type in `login.service.ts`, `userRepository` import in `auth-hook.ts`, and `LoginResult` exhaustive mapping in `login.router.ts`.
- [ ] T023 Run full test suite `pnpm test` — all tests green including F-01 and F-02 regression tests. Confirm no existing tests broken by auth-hook modification.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundation)**: Requires Phase 1 — **BLOCKS all user story phases**
- **Phase 3 (US1)**: Requires Phase 2 complete
- **Phase 4 (US2)**: Requires Phase 2 complete — can run in parallel with Phase 3
- **Phase 5 (US3)**: Requires Phase 2 complete — can run in parallel with Phases 3 and 4
- **Phase 6 (Polish)**: Requires all desired user story phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundation only — no dependency on US2 or US3
- **US2 (P2)**: Depends on Foundation only — `is_active` check already implemented in T009
- **US3 (P3)**: Depends on Foundation only — rate limiting already implemented in T008

### Within Each Phase

1. Tests (T004–T005, T011, T015, T017) → confirm FAIL
2. Implement (T006–T009, T012–T013, no new impl for US2/US3)
3. Run tests → confirm PASS
4. Checkpoint before next phase

### Parallel Opportunities

- T004 and T005 can be written in parallel (different files)
- T006, T007, T008 can be implemented in parallel (different files, no dependencies)
- T009 depends on T006 (imports `findById`)
- Once Phase 2 complete: T011 (US1), T015 (US2), T017 (US3) can be written in parallel
- T020, T021, and T022 can run in parallel (different files, no shared state)

---

## Parallel Example: Phase 2 Foundation

```bash
# Write tests in parallel (different files):
Task T004: apps/api/tests/unit/login.service.test.ts
Task T005: apps/api/tests/integration/auth-deactivation.test.ts

# Implement repositories in parallel (different files, no shared state):
Task T006: apps/api/src/modules/auth/user.repository.ts
Task T007: apps/api/src/modules/auth/login-attempt.repository.ts

# Then implement service (depends on T006 + T007):
Task T008: apps/api/src/modules/auth/login.service.ts

# Then modify auth-hook (depends on T006):
Task T009: apps/api/src/middleware/auth-hook.ts
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (Coordinator logs in)
4. **STOP and VALIDATE**: `POST /api/v1/auth/login` with coordinator seed credentials → JWT → use on `GET /api/v1/embryos` → 200
5. Admin login works; wrong password → 401; inactive → 401

### Incremental Delivery

1. Setup + Foundation → Core auth infrastructure ready
2. Add US1 → Login endpoint live (MVP)
3. Add US2 → Deactivation enforcement live
4. Add US3 → Rate limiting live
5. Polish → Seed script, F-02 compatibility, full regression

### Notes

- `[P]` tasks = different files, no blocking dependencies — safe to run in parallel
- `[USN]` label maps task to user story for traceability
- TDD: always confirm tests FAIL before implementing
- US2 and US3 require no new implementation beyond Phase 2 — only integration tests
- T020 (F-02 test updates, 11 files) is the most likely source of surprise failures — budget time for it; check each file's `sub` values individually
- T021 (auth-route-coverage) must be done before T023 — the coverage test will fail if the login route is missing from PUBLIC_ROUTES
