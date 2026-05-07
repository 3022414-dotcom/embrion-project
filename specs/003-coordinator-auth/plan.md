# Implementation Plan: F-03 — Coordinator and Admin Authentication

**Branch**: `003-coordinator-auth` | **Date**: 2026-05-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003-coordinator-auth/spec.md`

## Summary

Implement credential-based authentication for coordinators and admins on top of F-02's
authorization layer. Delivers: (1) PostgreSQL migration `004_users.sql` adding `users`
and `login_attempts` tables; (2) `POST /api/v1/auth/login` endpoint — email + password →
JWT `{ sub, role, clinic_id }` signed with the existing `@fastify/jwt` key; (3) `is_active`
check injected into the existing F-02 `auth-hook.ts` — one indexed DB query per
coordinator/admin request enabling immediate session invalidation; (4) bcrypt password
hashing via `bcryptjs`; (5) DB-backed rate limiting — 5 failures per email per 15 min →
429; (6) idempotent dev seed script for local setup.

## Technical Context

**Language/Version**: TypeScript 5.4 (strict mode) — same as F-01/F-02
**Primary Dependencies**: `bcryptjs` (new — password hashing); `@fastify/jwt` 8.x
(already installed — F-03 uses `jwt.sign()` in addition to F-02's `jwt.verify()`);
`postgres` 3.x (already installed); Node.js `crypto` built-in (not needed — bcryptjs
handles salt internally)
**Storage**: PostgreSQL 16 — two new tables via migration `004_users.sql`;
existing tables from F-01/F-02 unchanged
**Testing**: Vitest + Supertest integration tests with real PostgreSQL via testcontainers;
same pattern as F-01/F-02; `signTestToken()` / `signCoordinatorToken()` helpers unchanged
**Target Platform**: Linux server (Node.js 20 LTS) — same as F-01/F-02
**Project Type**: Web application — monorepo extension (backend API only for F-03)
**Performance Goals**: Login endpoint (including bcrypt at cost 12) under 2 seconds
SC-001; `is_active` DB check adds ~1–2 ms per coordinator/admin request — well within
the 200 ms p95 budget from the constitution; all existing endpoint SLAs unchanged
**Constraints**: `bcryptjs` cost factor fixed at 12; no refresh tokens; no new
coordinator/admin management endpoints (Variant A — seed + direct DB); JWT TTL fixed at
8 hours; rate-limit counter in DB (survives restarts, correct under concurrent load);
`is_active` check must never cache — reads DB on every request
**Scale/Scope**: Clinic-scale — same as F-01/F-02 (~hundreds of concurrent users,
dozens of staff accounts)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Code Quality | ✅ PASS | Each new file has one responsibility: `user.repository.ts` (DB queries for user records), `login-attempt.repository.ts` (rate-limit counter), `login.service.ts` (login orchestration), `login.router.ts` (HTTP handler). Modification to `auth-hook.ts` is additive (4 lines for is_active check). No dead code. |
| II. Testing Standards | ✅ PASS | TDD cycle enforced across all phases: tests written first, must fail, then implementation. Integration tests use real PostgreSQL via testcontainers. Unit tests cover login.service business logic. |
| III. UX Consistency | ✅ PASS (not applicable) | F-03 is API/data layer only — no user-facing UI surface. Error messages are human-readable and intentionally generic (no credential-existence leakage). |
| IV. Performance | ✅ PASS | `is_active` check: single indexed UUID lookup (~1–2 ms). Login endpoint: bcrypt at cost 12 (~250 ms) + two DB queries (~5 ms total) = well under SC-001's 2-second budget. Constitution p95 < 200 ms applies to non-login endpoints; the `is_active` overhead is within budget. |

**Post-design re-check**: ✅ All gates pass. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-coordinator-auth/
├── plan.md                        # This file
├── research.md                    # Phase 0 — tech decisions and rationale
├── data-model.md                  # Phase 1 — table schemas, types
├── contracts/
│   └── login-api.yml              # OpenAPI 3.1 — POST /api/v1/auth/login
└── tasks.md                       # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code

```text
apps/api/src/
├── app.ts                         # MODIFY: register loginRouter
├── middleware/
│   └── auth-hook.ts               # MODIFY: add is_active check after jwtVerify()
├── modules/
│   └── auth/                      # EXTEND existing module (no new module directory)
│       ├── user.repository.ts     # NEW: findByEmail, findById
│       ├── login-attempt.repository.ts  # NEW: countRecent, record, clearByEmail
│       ├── login.service.ts       # NEW: login() — rate check → verify → JWT
│       ├── login.router.ts        # NEW: POST /api/v1/auth/login
│       └── [existing F-02 files unchanged]
└── db/
    ├── migrations/
    │   └── 004_users.sql          # NEW: users + login_attempts tables
    └── scripts/
        └── seed.ts                # NEW: idempotent dev seed (tsx)

apps/api/tests/
├── integration/
│   ├── auth-login.test.ts         # NEW: US1 — login flow (success, failures, format)
│   ├── auth-deactivation.test.ts  # NEW: US2 — is_active enforcement end-to-end
│   └── auth-rate-limit.test.ts    # NEW: US3 — rate limiting (5 failures → 429)
└── unit/
    └── login.service.test.ts      # NEW: unit tests for login.service business logic
```

**Structure Decision**: All new auth files extend `apps/api/src/modules/auth/` — the
module pattern established in F-01/F-02. No new workspace packages or module directories.
`auth-hook.ts` modification is additive only — F-02 patient token path untouched.

---

## Phase 1: Setup

**Purpose**: Install dependency, create migration, scaffold stub files. No business logic yet.

- [ ] T001 Install `bcryptjs` and `@types/bcryptjs` — run
      `pnpm --filter @embrion/api add bcryptjs` and
      `pnpm --filter @embrion/api add -D @types/bcryptjs`.
- [ ] T002 Create `apps/api/src/db/migrations/004_users.sql` — `users` and
      `login_attempts` tables exactly as defined in `data-model.md`: columns, CHECK
      constraints, and indexes.
- [ ] T003 Create stub files with export stubs (no logic) — `user.repository.ts`,
      `login-attempt.repository.ts`, `login.service.ts`, `login.router.ts` — all in
      `apps/api/src/modules/auth/`.

**Checkpoint**: `pnpm --filter @embrion/api build` succeeds (stubs compile, no errors).

---

## Phase 2: Foundation — Data Access + Authentication Core

**Purpose**: Repositories, login service, and auth-hook modification. All US work depends
on this phase.

**⚠️ CRITICAL — TDD**: Write tests T004–T005 first, confirm they FAIL, then implement T006–T009.

### Tests — write first, must fail

- [ ] T004 [P] Write `apps/api/tests/unit/login.service.test.ts` — unit tests for
      `login.service.ts`: `login()` with correct credentials returns `{ status: 'ok', token }`;
      unknown email returns `{ status: 'invalid' }`; wrong password returns
      `{ status: 'invalid' }`; inactive account returns `{ status: 'inactive' }`;
      5 prior failures returns `{ status: 'rate_limited', retryAfterSeconds: N }`;
      success clears the failed-attempt counter. Must fail (no implementation).
- [ ] T005 [P] Write `apps/api/tests/integration/auth-deactivation.test.ts` — tests for
      `is_active` enforcement in auth-hook: coordinator JWT → 200; same JWT after
      `UPDATE users SET is_active = false` → 401; re-enable → must login again for new
      JWT. Must fail.

### Implementation

- [ ] T006 Create `apps/api/src/modules/auth/user.repository.ts`:
      `findByEmail(sql, email: string): Promise<User | null>` — normalises email to
      lowercase, queries `users` table;
      `findById(sql, id: string): Promise<{ isActive: boolean } | null>` — single indexed
      query by UUID, returns minimal projection for auth-hook.
- [ ] T007 [P] Create `apps/api/src/modules/auth/login-attempt.repository.ts`:
      `countRecent(sql, email: string, windowMinutes: number): Promise<number>` — counts
      rows in `login_attempts` where `email = $1 AND occurred_at > NOW() - $2 * INTERVAL
      '1 minute'`;
      `record(sql, email: string): Promise<void>` — inserts one row;
      `clearByEmail(sql, email: string): Promise<void>` — deletes all rows for email
      (called on successful login to reset counter, FR-011).
- [ ] T008 [P] Create `apps/api/src/modules/auth/login.service.ts` — export
      `login(sql, opts: { email: string; password: string; sign: SignFn }): Promise<LoginResult>`:
      1. Normalise email to lowercase.
      2. `countRecent(sql, email, 15)` — if ≥ 5, compute `retryAfterSeconds` and return
         `{ status: 'rate_limited', retryAfterSeconds }` immediately (before any DB user
         lookup — avoids timing oracle on locked accounts).
      3. `findByEmail(sql, email)` — if null, `record(sql, email)`, return `{ status: 'invalid' }`.
      4. If `!user.isActive`, return `{ status: 'inactive' }` — same 401 as wrong password
         (FR-003 — identical response wording, no leakage).
      5. `bcrypt.compare(password, user.passwordHash)` — if false, `record(sql, email)`,
         return `{ status: 'invalid' }`.
      6. `clearByEmail(sql, email)` — reset counter (FR-011).
      7. Build JWT payload: `{ sub: user.id, role: user.role, ...(user.clinicId ?
         { clinic_id: user.clinicId } : {}) }`.
      8. `sign(payload, { expiresIn: '8h' })` — return `{ status: 'ok', token }`.
      `SignFn` type: `(payload: object, opts: { expiresIn: string }) => string`.
- [ ] T009 Modify `apps/api/src/middleware/auth-hook.ts` — in the JWT success branch,
      after setting `request.caller` from JWT claims, add:
      `const user = await userRepository.findById(sql, claims.sub);`
      `if (!user || !user.isActive) return reply.status(401).send({ error: 'Unauthorized' });`
      Import `userRepository` from `../modules/auth/user.repository.js`. The `sql`
      instance is already available via `buildAuthHook(sql)` closure.
- [ ] T010 Run T004 and T005 — must now pass. Fix until green.

**Checkpoint**: Unit tests for login.service pass (correct/wrong/inactive/rate-limited
scenarios). Integration test confirms `is_active = false` → 401 on coordinator JWT.

---

## Phase 3: User Story 1 — Coordinator logs in (Priority: P1)

**Goal**: `POST /api/v1/auth/login` returns JWT with correct payload for active accounts.
**Independent Test**: POST correct coordinator credentials → receive JWT → use JWT on
coordinator-only endpoint → 200. POST correct admin credentials → JWT with no clinic_id.
POST wrong password → 401. POST correct credentials for inactive account → 401.

### Tests — write first, must fail ⚠️

- [ ] T011 [P] Write `apps/api/tests/integration/auth-login.test.ts` — US1 scenarios:
      coordinator login → 200 `{ token }` with `role: "coordinator"`, `clinic_id` present;
      admin login → 200 `{ token }` with `role: "admin"`, no `clinic_id`; JWT usable on
      `GET /api/v1/embryos` → 200; wrong password → 401 generic message; unknown email →
      401 same message; inactive account → 401 same message; missing body fields → 400;
      token expires after 8h (verify `exp` claim in decoded payload). Must fail.

### Implementation

- [ ] T012 Create `apps/api/src/modules/auth/login.router.ts` — register
      `POST /api/v1/auth/login` (no auth preHandler — public endpoint):
      validate body: `email` (non-empty string), `password` (non-empty string) → 400 if
      missing; call `loginService.login(sql, { email, password, sign: request.server.jwt.sign.bind(request.server.jwt) })`;
      map result to HTTP response per research Decision 7 status-code table.
- [ ] T013 Modify `apps/api/src/app.ts` — register `loginRouter` plugin alongside
      existing `embryoRouter` and `authRouter`.
- [ ] T014 Run T011 tests — must pass. Fix until green.

**Checkpoint**: Login endpoint functional. Coordinator and admin can obtain JWT.
JWT accepted by F-02 auth-hook. ✅ US1 independently testable.

---

## Phase 4: User Story 2 — Immediate deactivation (Priority: P2)

**Goal**: `is_active = false` takes effect on the very next request with an existing JWT.
**Independent Test**: Coordinator logs in → gets JWT → admin sets `is_active = false` →
coordinator's next request → 401. Verified end-to-end via integration test.

### Tests — write first, must fail ⚠️

- [ ] T015 [P] Write end-to-end deactivation scenario in
      `apps/api/tests/integration/auth-deactivation.test.ts` (complement T005 which was
      the auth-hook unit-style test): login → get JWT → direct SQL
      `UPDATE users SET is_active = false WHERE id = $1` → GET /embryos with JWT → 401.
      Re-enable via SQL → coordinator must login again (old JWT rejected; new JWT after
      re-login → 200). Must fail before T009 passes; re-run here for final validation.
- [ ] T016 Run T015 tests — must pass (implementation completed in T009). Fix if needed.

**Checkpoint**: `is_active = false` → immediate 401. Re-enable → new login required. ✅ US2 independently testable.

---

## Phase 5: User Story 3 — Rate limiting (Priority: P3)

**Goal**: 5 failed attempts for one email within 15 minutes → 429 with retry_after_seconds.
**Independent Test**: 5 × POST wrong-password for email A → 6th attempt (correct password)
→ 429. Email B unaffected throughout. Manual counter reset (DELETE FROM login_attempts)
→ 7th attempt for email A → 200.

### Tests — write first, must fail ⚠️

- [ ] T017 [P] Write `apps/api/tests/integration/auth-rate-limit.test.ts` — US3 scenarios:
      5 failed attempts → 429 on 6th; correct password on 6th → still 429; other emails
      unaffected; successful login resets counter (attempt after success → 200); 429 body
      contains `retry_after_seconds > 0`. Must fail before T008 passes; re-run here.
- [ ] T018 Run T017 tests — must pass (implementation completed in T008). Fix if needed.

**Checkpoint**: Rate limiting active. 429 response includes `retry_after_seconds`.
Successful login resets counter. ✅ US3 independently testable.

---

## Phase 6: Seed Script + Polish

**Purpose**: Dev seed, type safety, full regression.

- [ ] T019 Create `apps/api/src/db/scripts/seed.ts` — import `bcryptjs` and `postgres`;
      read `DATABASE_URL` from `process.env`; hash `password123` at cost 12 for both
      accounts; `INSERT INTO users ... ON CONFLICT (email) DO NOTHING` for the two
      accounts defined in `data-model.md`; log success/skip per row; exit 0. Test by
      running twice — second run must produce no errors and no duplicate rows.
- [ ] T020 [P] Run `pnpm --filter @embrion/api typecheck` (`tsc --noEmit`) — zero type
      errors. Pay attention to `SignFn` injection in `login.service.ts` and the
      `userRepository` import in `auth-hook.ts`.
- [ ] T021 [P] Run full test suite: `pnpm test` — all tests green, including F-01 and
      F-02 regression tests. Confirm auth-hook modification does not break F-02
      coordinator/admin tests (those tests use `signTestToken` which produces real JWTs
      but the `sub` values are not in the `users` table — ensure `findById` returning
      `null` → 401 is acceptable in F-02 test context, or update F-02 tests to seed a
      matching user row).
- [ ] T022 [P] Update F-02 integration tests if T021 reveals failures — F-02 tests that
      use coordinator/admin JWTs will now hit the `is_active` check. Options: (a) seed a
      test user in each affected test's `beforeAll`, or (b) add a bypass for test JWTs
      where `sub` is not a real UUID (`"test-coordinator-id"` etc.) — option (a) is
      preferred as it validates the full stack.

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

### Key Integration Points with F-02

| F-02 file | F-03 change |
|-----------|-------------|
| `auth-hook.ts` | Add `is_active` DB check after `jwtVerify()` (coordinator/admin path only) |
| `app.ts` | Register `loginRouter` plugin |
| `tests/helpers/auth.ts` | No change — test JWT helpers remain valid |
| F-02 integration tests | May need `users` row seeded in `beforeAll` to pass the new `is_active` check |

---

## Implementation Notes

- **`is_active` check is coordinator/admin only**: Patient opaque tokens are validated
  against `access_tokens` table (F-02 logic) — the `users` table is not consulted on
  the patient token path. Inactive patient access is controlled via token revocation.
- **Identical 401 for wrong password and inactive account**: Both scenarios return
  `{ error: "Invalid credentials" }` — no hint about whether the account exists or is
  active (FR-003). The `{ status: 'inactive' }` internal variant exists only so the
  service can log differently if needed in future; the HTTP layer collapses both to 401.
- **Rate limit checked before password verification**: Prevents timing oracle — an attacker
  cannot determine if an email is valid by observing whether the response is slow (bcrypt)
  or fast (rate-limit rejection).
- **bcryptjs cost 12**: ~250 ms on a modern CPU. Login endpoint stays under SC-001's
  2-second budget with room to spare. Do not use `bcrypt.hashSync` in production code —
  async `bcrypt.hash` / `bcrypt.compare` only, to avoid blocking the event loop.
- **Seed script is a devDependency concern**: `seed.ts` is only run during local setup,
  not on application startup. It must not be imported by any production code path.
- **F-02 test compatibility**: The existing coordinator/admin integration tests (T021,
  T022 in F-02's plan) used `signTestToken` with `sub` values like `"coord-a"`. After
  F-03's auth-hook modification, these requests will hit `findById("coord-a")` → null
  → 401. Seed a matching `users` row in `beforeAll` for each affected test file.
