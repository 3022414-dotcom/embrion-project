# Research: F-03 — Coordinator and Admin Authentication

**Branch**: `003-coordinator-auth` | **Date**: 2026-05-07
**Status**: Complete — all decisions resolved

---

## Decision 1: Password Hashing Library

**Decision**: `bcryptjs` (pure JavaScript npm package)

**Rationale**: bcrypt is the established standard algorithm for password hashing in web
applications — adaptive cost factor, built-in salt management, resistant to GPU acceleration.
`bcryptjs` is a pure JavaScript implementation with zero native dependencies, requiring no
platform-specific build step. This is the simplest correct choice for a learning project.
Cost factor: 12 (balances security and login latency within SC-001's 2-second budget —
bcrypt at cost 12 takes ~250ms on a modern CPU).

**Alternatives considered**:
- Node.js `crypto.scrypt` (built-in — zero new deps): valid alternative, but scrypt API
  requires manual salt management (generate, store as `"salt:hash"`, split on verify).
  Extra code for no educational benefit at this scale.
- `@node-rs/bcrypt` (native binding — faster): eliminates pure-JS overhead but requires
  a native compile step, breaking on environments without build tools. Rejected for
  development simplicity.

**New dependency**: `bcryptjs` + `@types/bcryptjs` (devDependency).

---

## Decision 2: JWT Signing

**Decision**: Use `fastify.jwt.sign()` from the existing `@fastify/jwt` plugin — no new
dependency needed.

**Rationale**: `@fastify/jwt` (already installed for F-02 verification) also exposes
`fastify.jwt.sign(payload, options)` for token issuance. The same secret used for
verification is used for signing — F-03 and F-02 share one key, consistent with the
spec's assumption. From a route handler: `request.server.jwt.sign(payload, { expiresIn: '8h' })`.
The login service receives a `sign` function injected from the route handler to remain
testable without framework coupling.

**Alternatives considered**:
- `jsonwebtoken` npm package: redundant — `@fastify/jwt` already wraps it.
- Separate JWT secret for F-03 tokens: rejected — F-02 verifies tokens F-03 issues, so
  they must share the same secret.

---

## Decision 3: `is_active` Check Integration Point

**Decision**: Modify `auth-hook.ts` — add one indexed DB query (`SELECT is_active FROM
users WHERE id = $1`) immediately after `jwtVerify()` succeeds on the coordinator/admin
path.

**Rationale**: The check must happen on every authenticated request to satisfy FR-006 and
SC-002 (immediate deactivation effect). Placing it in the auth hook is the only location
that intercepts 100% of coordinator/admin requests before any handler logic runs.

**Performance impact**: One `SELECT` on an indexed UUID column (~1–2 ms p95 on PostgreSQL
with a warm buffer pool). Total coordinator request overhead stays well under the 200ms
p95 budget from the constitution.

**Scope boundary**: Patient opaque tokens are validated via the `access_tokens` table
(existing F-02 logic). The `users` table lookup is only on the JWT path. No change to the
patient token flow.

**Edge case**: If `users` row not found for a valid JWT `sub`, return 401 — the account
was deleted or the token is stale. This is safe-fail behavior.

---

## Decision 4: Module Structure

**Decision**: New files inside the existing `apps/api/src/modules/auth/` module.

**Rationale**: User authentication is a sub-concern of the same auth module that manages
patient tokens. Adding `user.repository.ts`, `login-attempt.repository.ts`,
`login.service.ts`, and `login.router.ts` to the existing module avoids creating a new
workspace package or a new module directory. Four files with clear names and single
responsibilities — no abstraction overhead, consistent with the project's module pattern
from F-01/F-02.

**New files (all in `apps/api/src/modules/auth/`):**
- `user.repository.ts` — `findByEmail`, `findById`
- `login-attempt.repository.ts` — `countRecent`, `record`, `clearByEmail`
- `login.service.ts` — `login()` orchestration (rate check → find user → verify → JWT)
- `login.router.ts` — registers `POST /api/v1/auth/login`

**Modified files:**
- `apps/api/src/middleware/auth-hook.ts` — add `is_active` check after JWT verify
- `apps/api/src/app.ts` — register `loginRouter`

---

## Decision 5: Seed Script

**Decision**: TypeScript seed script at `apps/api/src/db/scripts/seed.ts`, run via `tsx`.

**Rationale**: The seed needs to hash passwords before inserting — not possible in plain
SQL. `tsx` is already installed as a devDependency (used for `dev` script). The seed uses
`INSERT ... ON CONFLICT (email) DO NOTHING` for idempotency (FR-014). Reads DB connection
from the same `DATABASE_URL` environment variable as the main app.

**Seed accounts** (hardcoded for development):

| Role | Email | Password | clinic_id |
|------|-------|----------|-----------|
| coordinator | coordinator@clinic.test | password123 | clinic-001 |
| admin | admin@clinic.test | password123 | — |

**Run command**: `pnpm --filter @embrion/api exec tsx src/db/scripts/seed.ts`

---

## Decision 6: Rate-Limiting Window Semantics

**Decision**: Fixed window from the first failed attempt, implemented as a COUNT query
with a `WHERE occurred_at > NOW() - INTERVAL '15 minutes'` filter. No explicit deletion
of old records (Option A from spec clarifications).

**Rationale**: Simplest correct implementation. The window resets automatically as records
age out of the 15-minute range. The query uses the composite index on
`(email, occurred_at)` — single B-tree scan, negligible overhead.

**Lockout logic** (executed inside `login.service.ts`):
1. `countRecent(sql, email, 15 minutes)` — returns count of recent failed attempts.
2. If count ≥ 5 → return 429 immediately (before password verification — avoids timing
   oracle on locked accounts).
3. On authentication failure → `record(sql, email)` — insert one row.
4. On authentication success → `clearByEmail(sql, email)` — delete all rows for this
   email (counter reset per FR-011).

---

## Decision 7: Login Response Body

**Decision**: `{ "token": "<jwt>" }` — minimal envelope (confirmed in clarifications).

**HTTP status codes for the login endpoint:**

| Scenario | Status | Body |
|----------|--------|------|
| Success | 200 | `{ "token": "eyJ..." }` |
| Wrong credentials (any) | 401 | `{ "error": "Invalid credentials" }` |
| Inactive account | 401 | `{ "error": "Invalid credentials" }` (same message — no leakage) |
| Rate limit exceeded | 429 | `{ "error": "Too many attempts", "retry_after_seconds": <N> }` |
| Missing fields | 400 | `{ "error": "email and password are required" }` |

**Note on 429 body**: `retry_after_seconds` is computed as
`900 - seconds_since_first_recent_attempt` so the client can display a countdown without
probing the server repeatedly.
