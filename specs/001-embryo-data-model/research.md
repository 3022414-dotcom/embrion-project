# Research: F-01 — Embryo Data Model

**Phase**: 0 — Technology decisions and rationale
**Date**: 2026-05-01
**Branch**: `001-embryo-data-model`

---

## Decision 1: Monorepo Tooling

**Decision**: pnpm workspaces + Turborepo

**Rationale**: pnpm workspaces provide native package linking with strict dependency
isolation and disk-efficient deduplication. Turborepo adds a build/test pipeline with
remote caching — critical for a monorepo that will grow beyond F-01. Together they cover:
workspace hoisting, inter-package type-checking, and parallel task execution.

**Alternatives considered**:
- **npm/yarn workspaces** — slower installs, weaker isolation; rejected
- **Nx** — powerful but significantly heavier configuration overhead for a clinic-scale
  project; rejected in favour of Turborepo's simpler `turbo.json` pipeline model
- **Lerna** — legacy status; no longer the default choice for new monorepos; rejected

---

## Decision 2: Runtime Schema Validation Library

**Decision**: Zod 3.x

**Rationale**: Zod is TypeScript-first: schemas infer static types directly
(`z.infer<typeof EmbryoSchema>`), eliminating the need to maintain separate type
definitions alongside validators. This is the core of F-01 — the schema package must be
the single source of truth for both compile-time types and runtime validation. Zod also
supports `.transform()` for donor field inheritance logic and `.omit()` / `.pick()` for
building role-scoped projection schemas cleanly.

**Alternatives considered**:
- **Joi** — runtime-only, no TypeScript type inference; requires duplicate type
  declarations; rejected
- **Yup** — TypeScript support is weaker than Zod; `.infer` not as ergonomic; rejected
- **JSON Schema + ajv** — JSON Schema is the wire format (see `contracts/`), but ajv
  alone cannot generate TypeScript types; using both Zod and ajv would duplicate
  validation logic. Decision: Zod owns the canonical schema; JSON Schema in
  `contracts/embryo.schema.json` is generated from Zod via `zod-to-json-schema` for
  documentation and interoperability purposes only.

---

## Decision 3: Storage Model

**Decision**: PostgreSQL 16 with normalized relational columns

**Rationale**: Storing embryo sub-records as typed columns (not JSONB blob) enables:
(1) indexed filtering on donor traits (eye_color, ethnicity, height) — required by the
catalog feature (F-02); (2) column-level constraints enforced by the database as a
second validation layer; (3) standard SQL queries without JSONB operators.

Sub-records (egg_donor, sperm_donor, genetics, medical, matching, media, meta) are
stored as prefixed columns on the `embryos` table (e.g., `egg_donor_age`,
`egg_donor_eye_color`) rather than joined tables, because donors are embedded in the
embryo record (confirmed in spec clarification) and never queried independently.

**Alternatives considered**:
- **JSONB columns for sub-records** — flexible but loses indexability on donor fields;
  filters like "show embryos with egg donor eye color = blue" become GIN index scans
  with worse performance; rejected
- **Separate donor tables with foreign keys** — would imply donors are reusable
  entities, contradicting the embedded-donor decision from spec clarification; rejected
- **MongoDB** — document model natural fit for embedded sub-records, but adds
  operational complexity (second datastore) and loses ACID guarantees important for
  status transitions and soft-delete atomicity; rejected

---

## Decision 4: Role Visibility Enforcement Layer

**Decision**: Projection functions in `packages/schema/src/embryo.visibility.ts`,
enforced at the repository/service boundary in `apps/api`

**Rationale**: Role visibility MUST be enforced at the data layer, not in UI components
(per spec FR-002 and Constitution Principle I). Placing projection logic in the shared
`packages/schema` package means both API routes and any future server-side rendering
context use the same rules — no risk of divergence. Each role gets a typed projected
view: `EmbryoForPatient`, `EmbryoForCoordinator`, `EmbryoForAdmin`.

**Alternatives considered**:
- **Database row-level security (RLS)** — powerful but couples visibility rules to
  PostgreSQL schema; harder to test in unit tests and to evolve without migrations;
  rejected as primary layer (can be added as defence-in-depth later)
- **Middleware-level field stripping in HTTP handlers** — violates single-responsibility
  (handlers should not know the visibility matrix); rejected
- **GraphQL field resolvers** — would require migrating to GraphQL; out of scope for
  F-01; deferred to future consideration

---

## Decision 5: Schema Versioning Mechanism

**Decision**: Semver string in `packages/schema/src/embryo.manifest.ts` (as confirmed
in spec clarification Q4); each embryo record stores `meta_schema_version` column

**Rationale**: The manifest file is the authoritative version source — queryable without
touching embryo records. `zod-to-json-schema` generates `contracts/embryo.schema.json`
from the Zod schema at build time, embedding the version. Each record stores the schema
version at write time, enabling future migration scripts to target records by version.

**Version bumping rules** (from constitution):
- MAJOR: field removed, type changed incompatibly, visibility rule tightened
- MINOR: new optional field added, visibility rule relaxed
- PATCH: comment update, constraint description clarification

**Initial version**: `1.0.0`

---

## Unresolved Items

None. All NEEDS CLARIFICATION items from the spec have been resolved. Technical context
is complete.
