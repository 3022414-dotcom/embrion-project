# Feature Specification: F-01 — Embryo Data Model

**Feature Branch**: `001-embryo-data-model`
**Created**: 2026-04-30
**Status**: Draft
**Input**: User description: F-01 — Embryo Data Model (JSON schema, role visibility matrix,
statuses, donor field inheritance rules, storage-level validation)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Doctor curates embryo catalog for a patient (Priority: P1)

A doctor opens the clinic's admin interface, views a list of available embryos, and
confirms that the data displayed matches the agreed data model: all required fields are
present, status is correct, and sensitive fields (embryo sex, extended genetics) are
visible to the doctor but not exposed to patients.

**Why this priority**: The data model is the foundation of every downstream feature. Without
a well-defined and validated embryo record, the catalog, filtering, and selection flows
cannot function correctly.

**Independent Test**: A doctor with coordinator-level access can retrieve a full embryo
record and see all fields including `sex`, `chromosomal_abnormalities`, and internal IDs.
The test is complete when a patient-role retrieval of the same record returns the same
embryo without restricted fields.

**Acceptance Scenarios**:

1. **Given** an embryo record stored in the system,
   **When** a doctor (coordinator role) retrieves it,
   **Then** all fields including `sex`, internal IDs, and extended genetics are returned.

2. **Given** an embryo record with `sex` populated,
   **When** a patient retrieves the same record via their access link,
   **Then** the response does NOT contain the `sex` field or any field marked
   patient-hidden in the role visibility matrix.

3. **Given** an embryo in `available` status,
   **When** a coordinator changes its status to `reserved`,
   **Then** the status is updated and the change is logged with a timestamp and actor ID.

4. **Given** a patient attempting to change embryo status,
   **When** the request is submitted,
   **Then** the system rejects the request with a permission error.

---

### User Story 2 — Patient browses embryo cards (Priority: P2)

A patient opens their personalized catalog via a unique link. Each embryo card displays
only the fields permitted for patient visibility: donor phenotype, genetics summary,
embryo quality grade, and availability status. No restricted fields are leaked.

**Why this priority**: Patient trust depends on the data model correctly filtering sensitive
information. An inadvertent exposure of embryo sex or internal identifiers constitutes a
compliance violation.

**Independent Test**: A patient accessing their catalog sees embryo cards with donor
phenotype data, quality info, and `screening_status` — but no `sex` field, no internal
clinic IDs, no `chromosomal_abnormalities` flag, and no `risk_factors` list.

**Acceptance Scenarios**:

1. **Given** a patient catalog containing 3 embryos,
   **When** the patient views the list,
   **Then** each card shows only patient-permitted fields as defined in the role visibility
   matrix.

2. **Given** an embryo with `reserved` status,
   **When** the patient views the catalog,
   **Then** the embryo is shown with a "reserved" label but cannot be selected for inquiry.

---

### User Story 3 — Admin manages embryo records (Priority: P3)

An admin creates, edits, and deactivates embryo records. The system validates each record
against the full schema before persisting it. Records that fail validation are rejected
with a human-readable error message identifying the failing field.

**Why this priority**: Data integrity at the source prevents cascading errors in the catalog
and selection flows.

**Independent Test**: Submitting an embryo record with a missing required field returns a
validation error naming the exact field. A complete, valid record is accepted and
retrievable immediately after creation.

**Acceptance Scenarios**:

1. **Given** an embryo record missing the `embryo_quality_grade` field,
   **When** an admin submits it,
   **Then** the system returns a validation error citing `embryo_quality_grade` as required.

2. **Given** a complete, valid embryo record,
   **When** an admin submits it,
   **Then** the record is persisted and retrievable with all fields intact, including
   donor-inherited fields computed per inheritance rules.

3. **Given** an embryo record where `egg_donor` fields and `predicted_phenotype` fields
   are provided,
   **When** the record is saved,
   **Then** any predicted phenotype fields absent in the record are automatically derived
   from donor data according to the inheritance rules (eye color priority, height range).

---

### Edge Cases

- What happens when a donor field used in phenotype inheritance is absent?
  The system MUST log a warning and leave the derived field null rather than blocking
  record creation.
- What happens when a coordinator releases a reservation (`reserved → available`)?
  The system MUST allow the transition, clear `reservation_expiry`, and log the release
  with actor ID and timestamp.
- How does the system handle a status change to `used` for a record that is still
  `available` (skipping `reserved`)?
  The system MUST allow the transition (it is a permitted direct path) and log it with
  actor ID and timestamp.
- What happens if a coordinator attempts to transition out of `used` status?
  The system MUST reject the request with an error: "`used` is a terminal status."
- What happens when an admin soft-deletes an embryo that is currently `reserved`?
  The soft-delete MUST succeed; the reservation is implicitly cancelled; `deleted_at`
  is set; donor fields are anonymised. The coordinator who held the reservation MUST be
  notified (notification mechanism is out of scope for this feature).
- What if two coordinators attempt to reserve the same embryo simultaneously?
  The system MUST apply last-write-wins with conflict detection, ensuring only one
  reservation is accepted and the other receives a conflict error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define a complete embryo data schema covering all fields in
  the data model (basic info, egg donor, sperm donor, predicted phenotype, genetics,
  medical, matching, media, meta).
- **FR-002**: The system MUST enforce a role visibility matrix: fields marked as
  patient-hidden MUST NOT be returned in any patient-facing response.
- **FR-003**: The `sex` field MUST be accessible only to coordinator and admin roles.
- **FR-003a**: Within the Genetics sub-record, `chromosomal_abnormalities` and `risk_factors`
  MUST be accessible only to coordinator and admin roles. The `screening_status` field
  MUST be visible to all roles including patient.
- **FR-004**: Embryo status MUST be one of: `available`, `reserved`, or `used`. No other
  values are permitted.
- **FR-005**: Status transitions MUST be restricted: only coordinator and admin roles can
  change embryo status. Patient role MUST be rejected with a permission error. Permitted
  transitions: `available → reserved`, `reserved → available` (release), `available → used`,
  `reserved → used`. The `used` status is terminal — no transition out of it is permitted.
- **FR-006**: The system MUST apply donor field inheritance rules: predicted phenotype fields
  (eye color, hair color, height range, skin tone) are derived from egg and sperm donor
  data when not explicitly provided.
- **FR-007**: Storage-level validation MUST reject any embryo record missing required fields,
  returning a human-readable error identifying the failing field(s).
- **FR-008**: The embryo data schema MUST be versioned using semantic versioning
  (MAJOR.MINOR.PATCH). The authoritative version MUST be stored in a dedicated schema
  manifest (not in individual records). Each embryo record MUST store a `schema_version`
  field capturing the schema version active at the time the record was created or last
  migrated. MAJOR increments on breaking field changes; MINOR on additive changes;
  PATCH on documentation or constraint clarifications.
- **FR-009**: All status changes MUST be logged with timestamp, actor role, and actor
  identifier for audit purposes.
- **FR-010**: The system MUST support field-level documentation describing each field's
  purpose, permitted values, and role visibility, accessible to developers and auditors.
- **FR-011**: The system MUST support a soft-delete operation on embryo records: the record
  MUST be marked with a `deleted_at` timestamp, all donor personal fields (age, blood type,
  education, ethnicity, height, eye color, hair color — for both egg and sperm donor) MUST
  be replaced with null, and embryo medical fields MUST be retained. Soft-deleted records
  MUST NOT appear in any patient-facing or coordinator catalog view. Only admin role may
  initiate a soft-delete.

### Key Entities

- **Embryo**: The central record. Contains all fields from the data model. Status lifecycle:
  `available` → `reserved` → `used`; reverse transition `reserved` → `available` is
  permitted (e.g., patient cancels selection); `used` is terminal. Egg and sperm donor data
  are embedded directly within the embryo record — donors have no independent identity or ID.
- **Egg Donor**: Embedded nested object within the embryo record. Not a separate entity;
  has no ID of its own. Fields: age, blood type, education, ethnicity, height, eye color,
  hair color. Each embryo owns its own copy of this data.
- **Sperm Donor**: Same structure as Egg Donor — embedded, no independent ID.
  Contributes to phenotype inheritance.
- **Predicted Phenotype**: Derived sub-record. Fields: eye color, hair color, height range,
  skin tone. Computed from donor data if not explicitly set.
- **Genetics**: Sub-record. Fields: `screening_status` (visible to all roles including
  patient), `chromosomal_abnormalities` flag (coordinator + admin only),
  `risk_factors` list of {name, severity_level} (coordinator + admin only).
- **Medical**: Sub-record. Fields: quality grade (A/B/C), development stage (blastocyst
  etc.), freeze date.
- **Matching**: Sub-record. Fields: compatible blood types list, notes.
- **Media**: Sub-record. Fields: embryo image reference, donor photo availability flag.
- **Meta**: Sub-record. Fields: reservation expiry timestamp, priority score,
  `schema_version` (semver string — the schema version under which this record was
  created or last migrated; read-only after write), `deleted_at` (timestamp — null
  when active; set on soft-delete; triggers donor field anonymisation).
- **Schema Manifest**: A standalone versioned document (not an embryo record) that
  declares the current schema version (semver), its effective date, and a changelog
  of field-level changes since the previous version. Queryable without accessing
  individual embryo records.
- **Role Visibility Rule**: A mapping of field → permitted roles. Enforced at the data
  access layer, not in UI code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of fields listed in the project data model are covered by the schema with
  explicit types and role visibility classifications — verifiable by comparing schema
  documentation against the `summary.md` data model section.
- **SC-002**: A patient-role access attempt for any embryo returns zero restricted fields
  (including `sex`, internal IDs, `chromosomal_abnormalities`, `risk_factors`) and
  returns `screening_status` — verifiable by automated role matrix tests.
- **SC-003**: A coordinator-role status change request for any embryo succeeds within the
  normal response time window; a patient-role status change request is rejected 100% of
  the time.
- **SC-004**: Every invalid embryo record submitted to the system produces a validation
  error that names the failing field — verifiable by submitting records with each required
  field missing in turn.
- **SC-005**: The schema manifest exists, contains a valid semver string, and is
  queryable independently of embryo records. Every embryo record contains a
  `schema_version` field. On any breaking schema change, the MAJOR version increments
  and the manifest changelog is updated — verifiable by inspecting the manifest before
  and after a simulated breaking change.

## Clarifications

### Session 2026-04-30

- Q: Are egg/sperm donor records embedded within the embryo record or separate reusable entities? → A: Embedded — donor data is a nested object within each embryo record; donors have no independent ID and cannot be shared between embryos.
- Q: Can embryo status be reversed (e.g., `reserved → available`)? → A: Partial reversal — `reserved → available` is permitted; `used` is terminal and cannot be reversed.
- Q: Which Genetics sub-fields are visible to a patient? → A: Only `screening_status`; `chromosomal_abnormalities` and `risk_factors` are restricted to coordinator and admin roles.
- Q: How should schema versioning be implemented? → A: Semver string (MAJOR.MINOR.PATCH) in a dedicated schema manifest; each embryo record also stores `schema_version` to record which schema version it was created under.
- Q: Should the data model support deletion or anonymisation of personal data on request? → A: Soft-delete with donor field anonymisation — record is marked `deleted_at`, donor personal fields are zeroed out, embryo medical fields are retained for audit and statistics.

## Assumptions

- The data model described in `summary.md` is the authoritative source of truth for field
  enumeration; no additional fields are in scope for this feature.
- "Coordinator" and "Doctor" roles share the same field visibility level for the purposes
  of this feature (both can see all fields including `sex`).
- Phenotype inheritance applies only to fields that are absent in the submitted record;
  explicitly provided values are never overwritten by inheritance logic.
- The schema versioning mechanism does not require automatic record migration tooling in
  this feature — the manifest tracks the current version and per-record `schema_version`
  enables future migration targeting.
- Russian-language field documentation is out of scope for this feature; English
  documentation is sufficient for developers and auditors.
- The `reservation_expiry` field in meta is set by the coordinator at reservation time;
  the system does not auto-expire reservations in this feature scope.
