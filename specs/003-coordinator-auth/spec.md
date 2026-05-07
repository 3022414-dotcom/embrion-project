# Feature Specification: F-03 — Coordinator and Admin Authentication

**Feature Branch**: `003-coordinator-auth`
**Created**: 2026-05-06
**Status**: Draft
**Input**: User description: "F-03 — Coordinator and admin login with email/password. JWT issuance matching the { sub, role, clinic_id } contract established in F-02. is_active check on every request. bcrypt password hashing. Rate limiting: 5 attempts per 15 min per email (DB-based counter). No refresh tokens, no SSO, no password reset. Learning project — maximum simplicity."

## Scope

**This feature covers: CREDENTIAL-BASED LOGIN and SESSION LIFECYCLE for coordinators and admins.**

| In scope ✅ | Out of scope ❌ |
|-------------|----------------|
| User record storage (`users` table: email, password hash, role, clinic, active flag) | Self-registration — users are created by admin only |
| `POST /auth/login` — email + password → JWT (8-hour TTL) | Refresh tokens |
| JWT payload `{ sub, role, clinic_id }` — matching the F-02 contract exactly | SSO / OAuth / external identity providers |
| `is_active` check on every authenticated request (extends F-02 auth hook) | Password reset / forgot-password flow (requires email delivery) |
| Password hashing with a one-way adaptive algorithm | Email verification on account creation |
| Brute-force protection: lock after 5 failed attempts per email within 15 minutes | User management UI (belongs to F-13) |
| Dev seed: one coordinator account + one admin account | Audit log for login events (belongs to a dedicated audit feature) |
| Immediate session invalidation when an admin deactivates an account | Multi-factor authentication |
| | Password change — no API endpoint; direct DB update only (same as account creation, Variant A) |

> **Dependency note**: F-02 already validates JWTs and enforces role-based access. F-03 adds the missing piece: issuing those JWTs via a login endpoint and providing the `users` table that the F-02 auth hook can query to confirm `is_active` on every request.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Coordinator logs in and accesses the system (Priority: P1)

A coordinator opens the login page, enters their clinic email address and password, and is granted access. The system returns a session token valid for one working day (8 hours). The coordinator can then use all protected API endpoints without re-entering credentials until the token expires or the account is deactivated.

**Why this priority**: This is the only entry point for coordinators and admins — every downstream feature (F-04, F-05, F-10) depends on a working login flow. Without it, no staff member can interact with the system at all.

**Independent Test**: Create a coordinator account. POST email + password to the login endpoint. Verify a JWT is returned with correct `{ sub, role, clinic_id }` claims. Use that JWT to call a coordinator-only endpoint from F-02 — verify 200.

**Acceptance Scenarios**:

1. **Given** a coordinator account exists and is active, **When** the coordinator submits correct email and password, **Then** the system returns a JWT with payload `{ sub: <user_id>, role: "coordinator", clinic_id: <clinic_id> }` and an 8-hour expiry.

2. **Given** a coordinator submits an incorrect password, **When** the request is processed, **Then** the system returns 401 with a generic error message (no hint whether email or password was wrong).

3. **Given** a JWT returned at login, **When** it is used on any protected endpoint before expiry, **Then** the request proceeds normally with the correct role and clinic scope.

4. **Given** a JWT that has passed its 8-hour expiry, **When** it is presented to any protected endpoint, **Then** the system returns 401 and the user must log in again.

5. **Given** an admin account (no clinic affiliation), **When** the admin logs in, **Then** the system returns a JWT with `{ sub: <user_id>, role: "admin" }` — no `clinic_id` field, consistent with F-02's admin caller contract.

---

### User Story 2 — Admin deactivates a compromised account with immediate effect (Priority: P2)

An administrator learns that a coordinator's credentials have been compromised. The admin marks that account as inactive. From that moment on, any request carrying the coordinator's JWT — even a still-valid one — is rejected. The coordinator must contact the admin to regain access.

**Why this priority**: Clinic data includes sensitive medical records. Without immediate invalidation, a compromised account retains access for up to 8 hours after the admin acts. This is the key reason `is_active` is checked on every request rather than relying solely on JWT expiry.

**Independent Test**: Issue a valid JWT for Coordinator A. Admin sets `is_active = false` on that account. Coordinator A immediately makes a request with the same JWT — verify 401. Re-enable the account — verify the same JWT is now rejected (expired by then or user must re-login).

**Acceptance Scenarios**:

1. **Given** a coordinator has an active JWT and an admin sets their account to inactive, **When** the coordinator makes their next API request with the existing JWT, **Then** the system returns 401 — the session is immediately invalidated.

2. **Given** an inactive coordinator account, **When** the coordinator attempts to log in with correct credentials, **Then** the system returns 401 — inactive accounts cannot obtain new tokens.

3. **Given** an admin re-activates a previously deactivated account, **When** the coordinator logs in again with correct credentials, **Then** a new JWT is issued and access is restored.

4. **Given** a coordinator's `clinic_id` is changed by an admin (e.g., transferred to another clinic), **When** the coordinator logs in again, **Then** the new JWT contains the updated `clinic_id` — the old JWT remains valid only until it expires or the account is briefly deactivated.

---

### User Story 3 — Brute-force protection blocks repeated failed login attempts (Priority: P3)

An attacker (or a user who forgot their password) submits repeated incorrect passwords for the same email address. After 5 failed attempts within a 15-minute window, the system temporarily blocks further login attempts for that email — returning an informative but non-specific error. The block lifts automatically after 15 minutes.

**Why this priority**: Without this protection, email/password accounts are trivially brute-forceable. However, it is lower priority than login (US1) and instant deactivation (US2) because both of those must work correctly first.

**Independent Test**: Submit 5 incorrect passwords for a valid email. Verify the 6th attempt returns a rate-limit error even with the correct password. Wait 15 minutes (or reset the counter manually in the test) — verify login succeeds again.

**Acceptance Scenarios**:

1. **Given** a valid email address, **When** 5 login attempts with incorrect passwords are made within 15 minutes, **Then** the 6th attempt (even with the correct password) returns a 429 response indicating the account is temporarily locked.

2. **Given** an account that has been locked due to failed attempts, **When** 15 minutes pass from the first failed attempt in the current window, **Then** the lock is lifted automatically and the next login attempt with correct credentials succeeds.

3. **Given** a successful login, **When** the user subsequently fails additional attempts, **Then** the failed-attempt counter resets from zero — a successful login clears the lockout state.

4. **Given** an attacker submitting requests with different email addresses, **When** one email is locked, **Then** other email addresses are not affected — rate limiting is per email, not per IP.

---

### Edge Cases

- What happens when a user submits a login request with an email that does not exist in the system? → System returns 401 with the same generic message used for wrong password — no information about whether the email exists.
- What happens when the `users` table is unavailable during an `is_active` check? → The request fails with 503; auth checks must not silently succeed when the DB is unreachable.
- What happens when an admin's own account is deactivated? → The admin loses access on their next request — same rule applies to all roles including admin. Another admin must restore access.
- What happens when a coordinator's JWT is presented after the 8-hour TTL, regardless of `is_active`? → 401 from JWT expiry check (happens first in F-02 auth hook, before the `is_active` DB query).
- What happens when two login requests arrive simultaneously for the same email? → Both are processed independently; the response is whichever JWT is returned last — no race condition because each login is a separate DB write.
- What happens when the failed-attempt counter is at 4 and the correct password is submitted? → Login succeeds; the counter resets to 0 — the 5th attempt (correct) must never trigger a lockout.

## Clarifications

### Session 2026-05-06

- Q: Should `is_active` be checked on every request or only on login? → A: Every request — this is required to make account deactivation take immediate effect (Scenario 2). One indexed DB query per request by `sub` (UUID).
- Q: Should rate limiting be per email only, or also per IP? → A: Per email only — per-IP limiting could block coordinators behind a shared clinic NAT and adds complexity. Per-email is sufficient for a learning project.
- Q: Should a successful login reset the failed-attempt counter? → A: Yes — counter resets on any successful authentication, so legitimate users are not unfairly locked out after intermittent mistakes.
- Q: Should the login response include any user profile data beyond the JWT? → A: No — the JWT payload contains sufficient information (`sub`, `role`, `clinic_id`). Additional profile data is a UI concern for future features.
- Q: How are coordinator accounts created if there is no self-registration? → A: Admin creates accounts directly via the database or a future admin panel (F-13). For the learning project, the dev seed script provides the initial accounts.
- Q: What is the login response body format? → A: `{ "token": "<jwt>" }` — minimal format. The JWT already contains `sub`, `role`, `clinic_id`, and `exp`; clients that need expiry or claims can decode the JWT locally.
- Q: How should stale `LoginAttempt` records (older than 15 minutes) be handled? → A: No explicit cleanup — old records are ignored by the rate-limit query via a `WHERE occurred_at > NOW() - 15 min` filter. Records accumulate passively; at clinic scale the volume is negligible.
- Q: Is password change (authenticated user replacing their own password) in scope for F-03? → A: No — out of scope entirely, consistent with Variant A. Password changes require direct database update by a system administrator. No API endpoint is provided in F-03.

## Requirements *(mandatory)*

### Functional Requirements

**Credential Authentication**

- **FR-001**: System MUST accept an email address and password, verify them against stored credentials, and return a time-limited session token (JWT) on success. The response body MUST be `{ "token": "<jwt>" }` — no additional envelope fields.
- **FR-002**: Passwords MUST be stored as one-way hashes — plaintext passwords must never be persisted or logged.
- **FR-003**: Login failure responses MUST use identical wording regardless of whether the email does not exist or the password is incorrect — no information leakage about account existence.
- **FR-004**: Session tokens MUST expire after 8 hours from issuance. Expired tokens MUST be rejected with a 401 response.
- **FR-005**: The JWT payload MUST contain exactly `{ sub, role, clinic_id }` for coordinators and `{ sub, role }` (no `clinic_id`) for admins — matching the contract established in F-02.

**Active Session Validation**

- **FR-006**: On every authenticated request (not only at login), the system MUST verify that the token's subject (`sub`) maps to an active user record (`is_active = true`). A deactivated account MUST be rejected with 401 regardless of JWT validity.
- **FR-007**: Deactivating a user account MUST take effect on the very next request that user makes — no grace period, no cached validity.
- **FR-008**: An inactive account MUST NOT be able to obtain a new token via the login endpoint.

**Brute-Force Protection**

- **FR-009**: The system MUST track failed login attempts per email address. After 5 consecutive failures within a 15-minute window, the system MUST reject all further login attempts for that email (including correct passwords) with a 429 response for the remainder of the window.
- **FR-010**: The lockout window MUST reset automatically 15 minutes after the first failed attempt in the current window — no manual admin intervention required to unlock.
- **FR-011**: A successful login MUST reset the failed-attempt counter for that email to zero.

**User Records**

- **FR-012**: Each user record MUST store: unique identifier, email address (unique across the system), password hash, role (`coordinator` or `admin`), clinic affiliation (required for coordinators, absent for admins), active flag, and creation timestamp.
- **FR-013**: F-03 MUST NOT expose any endpoint for creating user accounts. There is no registration form, no admin API for creating users, and no self-service flow. All account provisioning happens outside the application: via the seed script (development) or direct database insert (production). The system exposes only the login endpoint.

**Developer Seed**

- **FR-014**: The project MUST include a repeatable, idempotent seed script that inserts at least one coordinator account (with a known email, password, and clinic affiliation) and one admin account (with a known email and password, no clinic). Running the script multiple times MUST NOT create duplicates. This script is the only supported mechanism for account creation in F-03.

### Key Entities

- **User**: A staff member who can log into the system. Attributes: unique ID, email (unique), password hash (never exposed), role (`coordinator` | `admin`), clinic ID (coordinator only — absent for admin), active flag (true by default), creation timestamp. One user corresponds to exactly one role; there are no multi-role accounts.
- **LoginAttempt**: A record of a failed authentication attempt for rate-limiting purposes. Attributes: email address (index key), timestamp of attempt. Records older than 15 minutes are ignored by the lockout query (`WHERE occurred_at > NOW() - 15 min`) and are never explicitly deleted — no background cleanup job is required.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A coordinator with valid credentials can log in and receive a working session token in under 2 seconds under normal load conditions.
- **SC-002**: Account deactivation takes effect within one subsequent request — zero tolerance for stale session continuation after `is_active` is set to false.
- **SC-003**: After 5 failed login attempts within 15 minutes, 100% of subsequent attempts (including correct passwords) are rejected until the window resets — verified by automated test suite.
- **SC-004**: No login response reveals whether a given email address exists in the system — verified by comparing response bodies for unknown-email vs. wrong-password cases.
- **SC-005**: All protected endpoints enforce the `is_active` check — automated coverage must confirm no authenticated endpoint bypasses the check.

## Assumptions

- Account provisioning is entirely out-of-band: development accounts come from the seed script; production accounts are inserted directly into the database by a system administrator. F-03 provides no API endpoint for creating users — this is a deliberate scope decision (Variant A). User management UI is deferred to F-13.
- The JWT signing key is shared with F-02 — F-03 signs tokens; F-02 verifies them. Key management (rotation, environment-specific secrets) is out of scope for both features.
- The `is_active` check adds one indexed database query per authenticated request. This is acceptable for a clinic-scale deployment (hundreds of concurrent users) and is the simplest correct approach.
- Clinic affiliation (`clinic_id`) is assigned to a coordinator at account creation time. Changing it requires admin intervention (direct DB update or future admin UI). When changed, the coordinator must log in again to receive a JWT with the updated value.
- Password complexity requirements are not enforced at the API level for this learning project — any non-empty string is accepted as a password. This assumption should be revisited before production use.
- The 8-hour JWT TTL is fixed and not configurable per user or per session — simplicity over flexibility.
- The failed-attempt counter is stored in the database (not in memory), so it survives server restarts and works correctly in a multi-instance deployment.
- Login event logging (who logged in, when, from which IP) is out of scope for F-03. If needed, it belongs to a dedicated audit feature.
- The dev seed script is idempotent — running it multiple times does not create duplicate accounts.
