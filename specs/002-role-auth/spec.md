# Feature Specification: F-02 — Role Model and Authorization

**Feature Branch**: `002-role-auth`
**Created**: 2026-05-05
**Status**: Draft
**Input**: User description: "F-02 — Role Model and Authorization. 3 roles: patient / doctor / admin. Token-link with TTL bound to one patient. Role-based permissions matrix. Role-check middleware. Acceptance criteria: expired token → 401; one token → one patient; doctor cannot see data from another clinic; permissions enforced server-side not only in UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Patient accesses their doctor-curated embryo selection via token-link (Priority: P1)

A doctor reviews a patient's case, selects a pool of compatible embryos, and generates a unique time-limited link for that patient. When the patient opens the link, the system validates the token and grants read-only access to exactly the embryos the doctor included in their selection — no other embryos are visible, even if more are available in the clinic. If the link has expired or was revoked, the patient cannot proceed.

**Why this priority**: This is the only access mechanism for patients — without it, patients cannot interact with the system at all. The "doctor curates → patient browses" flow is the product's core loop. The token must be airtight: a leaked link must never reveal another patient's selection or any embryos outside the curated pool.

**Independent Test**: Doctor creates a selection of 3 embryos for Patient A, generates token. Patient A opens link — verify exactly 3 embryos are visible. Expire the token, retry — verify 401. Check that Patient A cannot access embryo IDs not in the selection.

**Acceptance Scenarios**:

1. **Given** a doctor who has curated a selection of embryos for Patient A and generated a token, **When** Patient A opens the access link, **Then** the system grants access and shows only the embryos the doctor explicitly included in Patient A's selection.

2. **Given** a token that has passed its expiry time, **When** any user presents that token, **Then** the system returns 401 and denies access.

3. **Given** a valid token issued to Patient A, **When** an attempt is made to use it to access an embryo not in Patient A's selection, **Then** the system returns 404 — the embryo appears to not exist for that patient.

4. **Given** a token that was explicitly revoked by the doctor, **When** Patient A presents that token, **Then** the system returns 401 regardless of expiry time.

5. **Given** a doctor who updates Patient A's selection after the token was issued (adds or removes embryos), **When** Patient A makes their next request, **Then** they see the updated selection — access scope is live, not snapshot.

---

### User Story 2 — Coordinator curates a patient selection and manages clinic data (Priority: P2)

A doctor (or coordinator acting on their behalf) authenticates and accesses the clinic's management interface. All data access is automatically scoped to their clinic. The doctor reviews available embryos, creates a curated selection for a specific patient, and generates a time-limited access link. They can also edit embryo records, manage patient lists, and see all fields including those hidden from patients (embryo sex, extended genetics). Attempts to access another clinic's data are silently rejected.

**Why this priority**: Clinic data isolation is a medical privacy requirement — a doctor seeing another clinic's data is a compliance violation. This story also validates the selection-creation flow, which is the upstream trigger for all patient access.

**Independent Test**: Create two clinics with one doctor each. Doctor A creates a patient selection with Clinic A embryos. Verify Doctor A cannot see or modify Clinic B records. Verify the selection is only visible within Clinic A context.

**Acceptance Scenarios**:

1. **Given** a doctor authenticated to Clinic A, **When** they request embryo records, **Then** only Clinic A's embryo records are returned — with all fields visible including those hidden from patients.

2. **Given** a doctor authenticated to Clinic A, **When** they request a specific embryo belonging to Clinic B, **Then** the system returns 404 (not 403 — the record must appear to not exist).

3. **Given** a doctor authenticated to Clinic A, **When** they create a patient selection and generate an access token, **Then** the selection and token are associated with Clinic A and cannot be accessed from Clinic B.

4. **Given** a patient token, **When** it is used on a doctor-only endpoint (e.g., create or edit an embryo record), **Then** the system returns 403.

---

### User Story 3 — Admin manages users and access tokens (Priority: P3)

An administrator uses the management interface to create patient access tokens, set their expiry duration, and revoke tokens when needed. The admin can also manage doctor accounts across the system and view audit logs of access events. Admin operations are not scoped to a single clinic — they can act across the entire system.

**Why this priority**: Admins are responsible for system-wide user lifecycle management. However, patient access and clinic data isolation (US1 and US2) must work first — admin tooling extends and manages the foundation, not the other way around.

**Independent Test**: Admin creates a patient token with a 24-hour TTL. Admin revokes the token. Patient attempts to use the token — verify 401. Admin creates a doctor account for Clinic B — verify doctor can access Clinic B data.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they issue a patient token with a 48-hour TTL, **Then** the token is valid for 48 hours and expires automatically after.

2. **Given** an admin who revokes an active patient token, **When** the patient presents that token, **Then** the system returns 401.

3. **Given** a doctor token (not admin), **When** it is used on an admin-only endpoint, **Then** the system returns 403.

4. **Given** an admin, **When** they create a new doctor account and assign it to a clinic, **Then** the doctor can authenticate and access only that clinic's data.

---

### Edge Cases

- What happens when a token is valid but the associated patient record has been deleted? → System returns 401 as if the token is invalid.
- What happens when a doctor removes an embryo from a patient's selection while the patient is actively browsing? → The embryo disappears from the patient's next request; in-flight requests for that specific embryo return 404.
- What happens when two requests arrive simultaneously with the same valid token (concurrent browsing)? → Both requests are served normally — the token is multi-use and valid for the entire TTL.
- What happens when a token is issued but the patient never uses it before it expires? → Token expires silently; no action needed. Coordinator may issue a new one.
- What happens when a coordinator issues a new token while the patient has an existing active one? → The old token is immediately revoked; only the new token is valid.
- What happens when a doctor is removed from a clinic and their session is still active? → Existing session must be invalidated at next request (permission check re-evaluates live role, not cached role).
- What happens when the system receives a token with a valid signature but from an unrecognized issuer? → System returns 401.

## Clarifications

### Session 2026-05-05

- Q: Is the patient token single-use (magic link → session) or multi-use (valid for entire TTL)? → A: Multi-use — the token is valid for its full TTL and the patient may open the link any number of times from any browser.
- Q: Can a patient have multiple active tokens simultaneously? → A: No — only one active token per patient. Issuing a new token automatically revokes the previous one.
- Q: Can a patient have multiple active selections simultaneously? → A: No — one selection per patient, edited in-place. The token always references this single selection; changes to it take effect immediately.
- Q: Should failed authentication/authorization attempts be logged? → A: Yes — add `expired_attempt` and `unauthorized_attempt` event types to `TokenAuditLog`.
- Q: How is `clinic_id` carried in the coordinator session — JWT claim or DB lookup per request? → A: JWT claim. Coordinator JWT payload: `{ sub, role, clinic_id }`. No DB lookup needed per request.

## Requirements *(mandatory)*

### Functional Requirements

**Patient Token Access**

- **FR-001**: System MUST issue unique, cryptographically random access tokens for each patient on demand by a doctor or admin.
- **FR-002**: Each token MUST be bound to exactly one patient record and MUST NOT grant access to any other patient's data.
- **FR-003**: Each token MUST have a configurable time-to-live (TTL) set at issuance time; default TTL is 30 days. The token is multi-use — the patient may open the access link any number of times within the TTL from any browser.
- **FR-004**: A request presenting an expired token MUST receive a 401 response with a reason indicating expiry.
- **FR-005**: A request presenting a revoked token MUST receive a 401 response regardless of the token's original expiry time.
- **FR-006**: Tokens MUST be single-patient — sharing a link does not grant access to a different patient's data.

**Role Definitions**

- **FR-007**: System MUST support exactly three roles: `patient`, `coordinator` (covers both doctors and coordinators — matches the role name already established in F-01), and `admin`.
- **FR-008**: Role `patient` grants read-only access exclusively to the embryos included in the patient's doctor-curated selection — no other embryos are accessible. Field projection from F-01 visibility matrix is applied (embryo sex, internal IDs, and extended genetics are hidden).
- **FR-009**: Role `coordinator` grants: read and write access to embryo records within their clinic; ability to create and update patient selections (curated embryo pools); ability to generate and revoke patient access tokens; visibility of all embryo fields including those hidden from patients (sex, chromosomal abnormalities, extended genetics, internal IDs).
- **FR-010**: Role `admin` grants full system access: user management, clinic configuration, token lifecycle management, embryo status changes, and cross-clinic read access for audit and analytics purposes.

**Permissions Matrix Enforcement**

- **FR-011**: Every protected endpoint MUST verify the caller's role server-side before responding; no endpoint may rely solely on client-side guards.
- **FR-012**: A request with insufficient role for the endpoint MUST receive a 403 response.
- **FR-013**: Role checks MUST be implemented as reusable middleware applied consistently across all protected routes. F-01 currently embeds role checks inline in the service layer — F-02 MUST extract these into dedicated middleware and remove the inline checks.
- **FR-014**: A request with no token or an unparseable token MUST receive a 401 response.

**Clinic Isolation**

- **FR-015**: All data queries executed in the context of a `coordinator` session MUST be automatically filtered to that coordinator's clinic. The `clinic_id` MUST be read from the `clinic_id` claim in the coordinator's JWT — F-02 MUST extend the JWT payload from F-01's `{ sub, role }` to `{ sub, role, clinic_id }` and replace the `"default-clinic"` placeholder.
- **FR-016**: A coordinator requesting a resource that exists but belongs to another clinic MUST receive a 404 response (not 403) — the resource must appear non-existent.
- **FR-017**: A coordinator creating a new resource MUST have that resource automatically associated with their clinic; they MUST NOT be able to assign it to another clinic.

**Patient Selection Scoping**

- **FR-021**: Each patient has at most one `PatientSelection` at a time. A patient's access token MUST be linked to that selection; the token grants access only to embryos currently in it.
- **FR-022**: When a doctor modifies a patient's selection (adds or removes embryos), the change MUST take effect immediately for subsequent patient requests — access scope is live, not a snapshot taken at token issuance.
- **FR-023**: A patient MUST NOT be able to request an embryo by ID unless that embryo is present in their selection; such requests MUST return 404.

**Token Lifecycle**

- **FR-018**: Doctors and admins MUST be able to revoke a patient token at any time, with immediate effect on subsequent requests.
- **FR-019**: The system MUST support issuing a new token to a patient at any time. Only one token per patient may be active simultaneously — issuing a new token MUST automatically revoke any previously active token for that patient.
- **FR-020**: All token lifecycle events (`issued`, `used`, `revoked`, `expired`) AND failed access attempts (`expired_attempt`, `unauthorized_attempt`) MUST be logged in `TokenAuditLog` with actor identity (or IP if unauthenticated), timestamp, and patient reference.

### Key Entities

- **PatientSelection**: `id`, `patient_id` (FK, unique — at most one active selection per patient), `clinic_id` (FK), `created_by` (coordinator/admin ID), `embryo_ids` (ordered list of FK references into the embryo catalog), `created_at`, `updated_at` — represents a curated pool of embryos prepared by a coordinator for a specific patient. Edited in-place; the active token always reflects the current state of this selection.
- **AccessToken**: Unique token string (cryptographically random), `patient_id` (FK), `selection_id` (FK → PatientSelection), `clinic_id` (FK), `expires_at` (timestamp), `issued_by` (doctor/admin ID), `issued_at`, `revoked_at` (nullable), `revoked_by` (nullable)
- **User**: `id`, `role` (`patient` | `coordinator` | `admin`), `clinic_id` (required for `coordinator`; null for `patient` and `admin`), `email` (optional for patient), `created_at`
- **Clinic**: `id`, `name`, `created_at`
- **TokenAuditLog**: `id`, `token_id` (FK, nullable — null for attempts with unrecognised tokens), `event` (`issued` | `used` | `revoked` | `expired` | `expired_attempt` | `unauthorized_attempt`), `actor_id` (nullable for unauthenticated requests), `actor_role` (nullable), `occurred_at`, `ip_address`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An expired token receives a 401 response in under 100 ms — no database queries execute after the expiry check fails.
- **SC-002**: Cross-clinic data access attempts are rejected in 100% of cases — zero false-negatives in automated test suite covering all data-access endpoints.
- **SC-003**: Every protected endpoint enforces role checks — automated coverage test must confirm no unguarded routes exist.
- **SC-004**: A doctor or admin can issue a patient token and the patient can access their catalog within 60 seconds of receiving the link.
- **SC-005**: Token revocation takes effect on the next request with no grace period — system does not cache token validity beyond the current request.
- **SC-006**: The permissions matrix is enforced entirely server-side — removing all client-side authorization code must not expose any additional data.

## Assumptions

- Doctor authentication (login with credentials) is out of scope for F-02; this feature assumes doctors and admins have a working session mechanism (to be implemented in F-03 or equivalent). F-02 focuses on the patient token-link flow and the role enforcement layer.
- The role name `coordinator` (not `doctor`) is used throughout the system to cover both doctors and coordinators — this is the canonical name established in F-01 (`packages/schema/src/embryo.types.ts`) and must not be changed. The product UI may display "Doctor / Coordinator" as a label, but the system role string is `coordinator`.
- A patient selection is always created before a token is issued: a doctor must first curate embryos and then generate a link. Issuing a token without an associated selection is not allowed.
- The UI for creating and editing a patient selection (adding/removing embryos) is a future catalog feature; F-02 defines the authorization boundary and data model for selections but does not include the management UI.
- The system is designed to support multiple clinics in one deployment (as established in F-01); F-02 enforces this boundary at the authorization layer.
- Patient email addresses are optional — a patient may receive their access link via the doctor (printed QR, messaging, in person) without an email on file.
- TTL values are configurable per token at issuance time; default TTL is 30 days.
- Token delivery mechanism (email, SMS, QR code) is out of scope for F-02; the system produces a token URL — delivery is a separate concern.
- The F-01 role visibility matrix (`projectEmbryo(role, embryo)`) is already implemented and will be reused directly by F-02's patient access layer.
- Coordinator and admin sessions use JWTs (consistent with F-01's existing `jwtVerify()` infrastructure). The coordinator JWT payload is `{ sub, role, clinic_id }` — F-02 extends F-01's `{ sub, role }` payload by adding `clinic_id`. The patient access token is a separate opaque mechanism (not a JWT) — it is validated against the `AccessToken` table, not via JWT signature verification.
