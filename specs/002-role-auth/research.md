# Research: F-02 — Authorization Layer

**Branch**: `002-role-auth` | **Date**: 2026-05-05
**Input**: spec.md clarifications + F-01 codebase survey

---

## Decision 1: Opaque Patient Token Format

**Decision**: `crypto.randomBytes(32).toString('hex')` — 64-character hex string, 256-bit entropy.

**Rationale**: Node.js built-in `crypto` module (no new dependency). 256-bit entropy makes
brute-force infeasible. Hex characters are URL-safe without encoding. Simple text equality
for DB lookup.

**Alternatives considered**:
- UUID v4: 122-bit entropy — insufficient for a patient-facing access link.
- JWT signed token: decodable client-side (exposes patient_id); requires secret management
  for a token that doesn't need signature verification — rejected.
- nanoid / ulid: additional dependency for no meaningful benefit over `crypto` — rejected.

---

## Decision 2: Token Storage — Raw vs Hashed

**Decision**: Store raw token value in DB with a unique index (no hashing).

**Rationale**: At 256-bit entropy, reading the raw value from the DB still leaves an attacker
with a 2^256 search space — the raw token is itself a secret of equivalent strength to a
hashed shorter value. Hashing (bcrypt) would add ~50–100 ms per validation, violating
SC-001 (< 100 ms for 401 response). SHA-256 is fast but adds code with marginal benefit.

**Deferred**: A security review in F-03 or a dedicated hardening feature may revisit this.
At clinic scale and with proper DB access controls, raw storage is acceptable.

---

## Decision 3: Dual Auth Strategy (JWT + Opaque Token)

**Decision**: Unified `onRequest` hook — try JWT verification first, fall back to opaque
token DB lookup. Sets a `request.caller` context object consumed by all downstream middleware
and handlers.

**Rationale**: Coordinators/admins use `@fastify/jwt` (no DB hit — fast path). Patients use
opaque token (single indexed DB lookup). The same routes serve all roles — no separate route
registrations needed. Matches the existing F-01 pattern (`jwtVerify()` in `onRequest`).

**Flow**:
```
onRequest:
  1. Extract Bearer token from Authorization header → missing → 401
  2. Try jwtVerify() → success → caller = { role, sub, clinic_id }
  3. JWT failure → query access_tokens WHERE token_value = $1
       - Active token found → caller = { role: 'patient', sub: patient_id,
                                         clinic_id, selection_id }
       - Token exists but expired → log expired_attempt → 401 ("token expired")
       - Token not found / invalid → log unauthorized_attempt → 401 ("unauthorized")
```

**Alternatives considered**:
- Separate route groups for patient vs coordinator: duplication of route logic — rejected.
- Middleware that checks token type via prefix (e.g., `pat_` vs `jwt_`): fragile — rejected.

---

## Decision 4: PatientSelection — Array vs Junction Table

**Decision**: PostgreSQL `UUID[]` array column (`embryo_ids`) in `patient_selections`.

**Rationale**: Preserves coordinator-defined ordering naturally. Array append/remove is O(n) but
at clinic scale (5–50 embryos per selection) this is negligible. Membership check via
`= ANY(embryo_ids)` is supported by a GIN index. No join required for the common access
pattern (load selection, then filter embryo query to those IDs).

**Alternatives considered**:
- Junction table `selection_embryos(selection_id, embryo_id, position)`: better FK integrity
  and scalable to thousands of embryos — deferred; over-engineering at clinic scale.
- JSONB column: no type safety, harder to query with SQL operators — rejected.

---

## Decision 5: Role Middleware Pattern in Fastify

**Decision**: `preHandler` hook factory `requireRole(...roles: Role[])` applied per-route.

**Rationale**: Fastify's `preHandler` runs after `onRequest` (auth context is set) but
before the route handler. Factory pattern `requireRole('coordinator', 'admin')` replaces
all `if (role === 'patient') throw { statusCode: 403 }` patterns currently embedded in
`embryo.service.ts` (4 places). Services become role-agnostic — testable without role
setup.

**Pattern**:
```typescript
// apps/api/src/middleware/require-role.ts
export function requireRole(...allowed: Role[]): preHandlerHookHandler {
  return async (request, reply) => {
    if (!allowed.includes(request.caller!.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}
// Usage:
app.post('/api/v1/embryos', { preHandler: requireRole('coordinator', 'admin') }, handler);
```

**Alternatives considered**:
- Global `preHandler` with route-level skip flags: harder to audit which routes are
  protected — rejected.
- Decorator pattern: non-standard for Fastify, adds indirection — rejected.

---

## Decision 6: Clinic Isolation — Repository-Level Filter

**Decision**: Repository functions accept `clinicId: string | undefined`. Coordinator calls
pass `request.caller.clinic_id` (from JWT); admin calls pass `undefined` (no filter).

**Rationale**: Isolation enforced at the DB query level — the most reliable layer.
Replaces the `"default-clinic"` stub in `embryo.router.ts:79`. Admin bypassing the filter
via `undefined` is explicit and auditable. No risk of leaking clinic data through service
or HTTP layer.

**Applied to `embryo.repository.ts`**:
- `findAll(sql, { clinicId, ... })` → adds `AND clinic_id = $1` when `clinicId` is defined.
- `findById(sql, id, clinicId)` → adds `AND clinic_id = $1`; returns `null` if mismatch
  (router converts to 404).
- `create(sql, payload, clinicId)` → always stamps `clinic_id = clinicId` from caller.

---

## Decision 7: patients Table Scope

**Decision**: Add a minimal `patients` table (id, clinic_id, name, created_at, created_by)
with no credentials. Credentials and login are F-03.

**Rationale**: `access_tokens` needs a stable FK anchor for `patient_id`. Without a
`patients` table, `patient_id` would be a loose UUID with no referential integrity. A
minimal table costs one migration and enables FK constraints, proper cascades, and
list-patients endpoints in F-02.

**Out of scope**: email/password, sessions, login endpoint — all deferred to F-03.

---

## Summary of New Dependencies

None. All decisions use existing stack: Node.js `crypto` (built-in), `@fastify/jwt`
(already installed), `postgres` (already installed), PostgreSQL array operators (native).
