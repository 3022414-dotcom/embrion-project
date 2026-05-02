---
description: "Task list for F-01 — Embryo Data Model"
---

# Tasks: F-01 — Embryo Data Model

**Input**: Design documents from `specs/001-embryo-data-model/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/ ✅, research.md ✅
**Revised**: 2026-05-02 — added FR-012/013 (create/update), fixed T036 migration, renumbered Polish phase

**Tests**: Included — required by Constitution Principle II (TDD NON-NEGOTIABLE).
Tests MUST be written first and MUST fail before implementation begins.

**Organization**: Tasks are grouped by user story to enable independent delivery.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1, US2, US3)
- Exact file paths included in every task description

## Path Conventions (monorepo)

- Schema package: `packages/schema/src/`, `packages/schema/tests/`
- Backend: `apps/api/src/modules/embryo/`, `apps/api/src/db/migrations/`
- Backend tests: `apps/api/tests/integration/`, `apps/api/tests/unit/`
- Frontend shared types: `apps/web/src/types/`

---

## Phase 1: Setup (Monorepo Initialization)

**Purpose**: Initialize the monorepo structure so all packages can be developed in parallel.

- [ ] T001 Create root `package.json` with pnpm workspace config (name: `embrion-monorepo`, private: true, engines: node 20)
- [ ] T002 Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` workspaces
- [ ] T003 Create `turbo.json` with build/test/lint pipeline (build depends on ^build; test depends on ^build)
- [ ] T004 [P] Scaffold `apps/api/` — create `package.json` (name: `@embrion/api`), `tsconfig.json`, `src/` tree per plan.md
- [ ] T005 [P] Scaffold `apps/web/` — create `package.json` (name: `@embrion/web`), `tsconfig.json`, `src/types/` directory
- [ ] T006 [P] Scaffold `packages/schema/` — create `package.json` (name: `@embrion/schema`, exports map), `tsconfig.json`, `src/` and `tests/` directories
- [ ] T007 [P] Create root `tsconfig.base.json` with strict mode, `target: ES2022`, `moduleResolution: Bundler`
- [ ] T008 [P] Create `.gitignore` additions: `node_modules/`, `dist/`, `.turbo/`
- [ ] T009 Run `pnpm install` to verify workspace links resolve correctly

**Checkpoint**: `pnpm --filter @embrion/schema build` succeeds (empty package, no errors).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `packages/schema` package — types, Zod validators, role visibility, manifest.
All user stories depend on this phase. No US work begins until T022 is complete.

**⚠️ CRITICAL**: Write tests FIRST (T010–T011), confirm they fail, then implement (T012–T020).

### Tests — write first, must fail

- [ ] T010 [P] Write `packages/schema/tests/embryo.schema.test.ts` — Zod validation tests: required fields, enum constraints, age/height ranges, schema_version regex. Must fail (no implementation yet).
- [ ] T011 [P] Write `packages/schema/tests/embryo.visibility.test.ts` — role projection tests: patient sees zero restricted fields (`sex`, `id`, `chromosomal_abnormalities`, `risk_factors`, `meta.*`); coordinator sees all; admin sees `deleted_at`. Must fail.

### Implementation

- [ ] T012 Create `packages/schema/src/embryo.types.ts` — full TypeScript type definitions for `Embryo`, `EggDonor`, `SpermDonor`, `Phenotype`, `Genetics`, `Medical`, `Matching`, `Media`, `Meta`, `RiskFactor`, all enums (`BloodType`, `EyeColor`, `HairColor`, `SkinTone`, `ScreeningStatus`, `DevelopmentStage`, `HeightRange`)
- [ ] T013 [P] Create `packages/schema/src/embryo.schema.ts` — Zod schemas mirroring every type in T012; constraints from data-model.md Validation Rules table; `.transform()` for phenotype inheritance logic
- [ ] T014 [P] Create `packages/schema/src/embryo.visibility.ts` — role visibility matrix as defined in data-model.md; `projectEmbryo(role: Role, embryo: Embryo)` function returning typed projected views (`EmbryoForPatient`, `EmbryoForCoordinator`, `EmbryoForAdmin`)
- [ ] T015 Create `packages/schema/src/embryo.manifest.ts` — `CURRENT_SCHEMA_VERSION = "1.0.0"`, `SchemaManifest` type, initial changelog entry `[{ version: "1.0.0", date: "2026-05-01", changes: ["Initial schema ratification"] }]`
- [ ] T016 Create `packages/schema/src/index.ts` — barrel export of all types, schemas, projection function, manifest
- [ ] T017 Run `packages/schema` tests — T010 and T011 must now pass (green)
- [ ] T018 Create `apps/api/src/db/migrations/001_embryo_schema.sql` — `CREATE TABLE embryos` with all columns from data-model.md (prefixed column naming: `egg_donor_age`, `egg_donor_eye_color`, etc.), CHECK constraints for status enum, NOT NULL constraints for required fields
- [ ] T019 [P] Add `@embrion/schema` as dependency in `apps/api/package.json`; add `@embrion/schema` as devDependency in `apps/web/package.json`
- [ ] T020 Create `apps/api/src/modules/embryo/embryo.repository.ts` — `findById`, `findAll`, `create`, `update` functions; Zod gate at write boundary (parse before INSERT/UPDATE); testcontainers-based integration test scaffold in `apps/api/tests/integration/embryo.repository.test.ts`

**Checkpoint**: `pnpm --filter @embrion/schema test` passes 100%. Foundation ready — US implementation can begin.

---

## Phase 3: User Story 1 — Doctor retrieves full embryo record (Priority: P1) 🎯 MVP

**Goal**: Coordinator/Admin can retrieve full embryo record with all fields. Role projection applied.
**Independent Test**: A coordinator bearer token → `GET /api/v1/embryos/:id` returns all fields including `sex`, `chromosomal_abnormalities`, internal `id`. Admin token → same result plus `deleted_at`.

### Tests for US1 — write first, must fail ⚠️

- [ ] T021 [P] [US1] Write `apps/api/tests/integration/embryo-get.test.ts` — contract tests for `GET /api/v1/embryos` and `GET /api/v1/embryos/:id` with coordinator token; assert all fields present; assert 404 for non-existent ID. Must fail.
- [ ] T022 [P] [US1] Write `apps/api/tests/unit/embryo.projection.test.ts` — unit tests for `embryo.projection.ts`: coordinator projection includes `sex`, `id`, `meta.*`; admin projection includes `deleted_at`. Must fail.

### Implementation for US1

- [ ] T023 [US1] Create `apps/api/src/modules/embryo/embryo.projection.ts` — thin adapter wrapping `projectEmbryo` from `@embrion/schema`; maps HTTP caller role to projection call; exports `projectForCaller(role, embryo)`
- [ ] T024 [US1] Create `apps/api/src/modules/embryo/embryo.service.ts` — `getById(id, role)`, `list(filters, role)` calling repository then applying projection; embryo phenotype inheritance logic on `create` (delegates to Zod `.transform()`)
- [ ] T025 [US1] Create `apps/api/src/modules/embryo/embryo.router.ts` — `GET /api/v1/embryos` and `GET /api/v1/embryos/:id` handlers; extract role from JWT; call service; return projected record
- [ ] T026 [US1] Add `GET /api/v1/schema/manifest` handler in `apps/api/src/modules/embryo/embryo.router.ts` returning `SchemaManifest` from `@embrion/schema`
- [ ] T027 [US1] Run US1 integration tests — T021 and T022 must now pass (green)

**Checkpoint**: `GET /api/v1/embryos/:id` with coordinator token returns full record with `sex` and all meta fields. ✅ US1 independently testable.

---

## Phase 4: User Story 2 — Patient browses catalog (Priority: P2)

**Goal**: Patient token → same endpoints return projected records with zero restricted fields.
**Independent Test**: Patient bearer token → `GET /api/v1/embryos/:id` response contains `screening_status` and phenotype fields; does NOT contain `sex`, `id`, `chromosomal_abnormalities`, `risk_factors`, any `meta.*` field.

### Tests for US2 — write first, must fail ⚠️

- [ ] T028 [P] [US2] Write `apps/api/tests/integration/embryo-patient-projection.test.ts` — patient token → `GET /api/v1/embryos/:id`; assert `sex` absent; assert `screening_status` present; assert `chromosomal_abnormalities` absent; assert `id` absent. Must fail.

### Implementation for US2

- [ ] T029 [US2] Update `apps/api/src/modules/embryo/embryo.router.ts` — enforce patient role cannot call status-change or delete endpoints (return 403); existing GET handlers already call `projectForCaller` — verify patient role flows correctly through projection chain
- [ ] T030 [US2] Add patient projection path in `packages/schema/src/embryo.visibility.ts` — strip `id`, `clinic_id`, `creation_date`, `sex`, `genetics.chromosomal_abnormalities`, `genetics.risk_factors`, `matching.notes`, entire `meta` sub-record
- [ ] T031 [US2] Run US2 integration tests — T028 must now pass (green)

**Checkpoint**: Patient token returns cards with `screening_status`, phenotype, medical, donor traits — and zero restricted fields. ✅ US1 and US2 independently testable.

---

## Phase 5: User Story 3 — Admin manages embryo records (Priority: P3)

**Goal**: Create + edit + delete embryo records; status transitions enforced; storage validation rejects invalid records.
**Independent Test**: (a) `POST /embryos` with valid body returns 201 with derived phenotype; missing required field returns 400 naming it. (b) `PATCH /embryos/:id` updates fields; patient returns 403. (c) Coordinator `PATCH /status` `reserved→available` succeeds; patient returns 403. (d) Admin soft-delete nullifies donor fields, retains medical fields.

### Tests for US3 — write first, must fail ⚠️

- [ ] T032 [P] [US3] Write `apps/api/tests/integration/embryo-status.test.ts` — coordinator: valid transitions succeed; terminal `used→available` returns 400; patient PATCH returns 403; concurrent reservation returns 409. Must fail.
- [ ] T033 [P] [US3] Write `apps/api/tests/integration/embryo-delete.test.ts` — admin POST delete: `deleted_at` set, donor fields null, medical fields intact; coordinator delete returns 403. Must fail.
- [ ] T034 [P] [US3] Write `apps/api/tests/integration/embryo-validation.test.ts` — POST with missing required fields returns 400 with field name in error body; valid POST returns 201 with derived phenotype fields populated. Must fail.

### Implementation for US3

- [ ] T035 [US3] Add status FSM to `apps/api/src/modules/embryo/embryo.service.ts` — `changeStatus(id, newStatus, actorId, role)`: validate permitted transitions table from data-model.md; reject forbidden transitions with 400; reject non-coordinator/admin with 403; optimistic locking for concurrent reservation (409 on conflict)
- [ ] T036 [US3] Add audit log in `apps/api/src/modules/embryo/embryo.service.ts` — `logStatusChange(embryoId, fromStatus, toStatus, actorId, actorRole, timestamp)` satisfying FR-009; create `apps/api/src/db/migrations/002_embryo_status_log.sql` with `CREATE TABLE embryo_status_log (id UUID PK, embryo_id UUID, from_status, to_status, actor_id, actor_role, changed_at TIMESTAMPTZ)`
- [ ] T037 [US3] Add `PATCH /api/v1/embryos/:id/status` handler in `apps/api/src/modules/embryo/embryo.router.ts` — parse body with Zod, call service, return updated projected record
- [ ] T038 [US3] Add soft-delete logic to `apps/api/src/modules/embryo/embryo.service.ts` — `softDelete(id, actorId, role)`: admin only; set `meta.deleted_at`; null out all `egg_donor.*` and `sperm_donor.*` and `phenotype.*` columns; if status was `reserved` transition to `available` first (audit logged)
- [ ] T039 [US3] Add `POST /api/v1/embryos/:id/delete` handler in `apps/api/src/modules/embryo/embryo.router.ts` — admin only (403 otherwise); call softDelete service; return 204
- [ ] T040 [P] [US3] Write `apps/api/tests/integration/embryo-create.test.ts` — `POST /api/v1/embryos`: valid payload returns 201 with derived phenotype populated; missing `medical.quality_grade` returns 400 with field name; patient token returns 403. Must fail.
- [ ] T041 [P] [US3] Write `apps/api/tests/integration/embryo-update.test.ts` — `PATCH /api/v1/embryos/:id`: coordinator updates `medical.quality_grade`; assert field changed in response; attempt to set `status` field returns 400; patient token returns 403. Must fail.
- [ ] T042 [US3] Add `createRecord(payload, actorId, role)` to `apps/api/src/modules/embryo/embryo.service.ts` — coordinator + admin only; validate against full Zod schema; run inheritance transform; stamp `meta.schema_version`; persist via repository; return projected record
- [ ] T043 [US3] Add `POST /api/v1/embryos` handler in `apps/api/src/modules/embryo/embryo.router.ts` — coordinator + admin only (403 otherwise); parse body with Zod; call `createRecord` service; return 201 with projected record
- [ ] T044 [US3] Add `updateRecord(id, partial, actorId, role)` to `apps/api/src/modules/embryo/embryo.service.ts` — coordinator + admin only; validate partial with Zod partial schema; reject if `status` field present (400 — use status endpoint); persist changes; return projected record
- [ ] T045 [US3] Add `PATCH /api/v1/embryos/:id` handler in `apps/api/src/modules/embryo/embryo.router.ts` — coordinator + admin only (403 otherwise); parse partial body; call `updateRecord` service; return 200
- [ ] T046 [US3] Run all US3 integration tests — T032, T033, T034, T040, T041 must now pass (green)

**Checkpoint**: All three user stories independently functional and testable. ✅

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Developer tooling, documentation completeness, CI pipeline.

- [ ] T047 [P] Add `generate:json-schema` script in `packages/schema/package.json` using `zod-to-json-schema`; run it to verify `contracts/embryo.schema.json` matches current Zod schema
- [ ] T048 [P] Configure ESLint in root with `@typescript-eslint/recommended`; add `lint` task to `turbo.json` pipeline
- [ ] T049 [P] Configure Vitest coverage thresholds in `packages/schema/vitest.config.ts` (branches: 90, functions: 95, lines: 90)
- [ ] T050 [P] Update `apps/web/src/types/embryo.ts` to re-export `EmbryoForPatient` and relevant enums from `@embrion/schema`
- [ ] T051 Run `quickstart.md` smoke validation — follow every code block in `specs/001-embryo-data-model/quickstart.md`; fix any steps that fail; verify FR-010 field documentation in `data-model.md` matches `embryo.types.ts`
- [ ] T052 Run full test suite: `pnpm test` — all tests green, coverage thresholds met
- [ ] T053 [P] Final `tsc --noEmit` across all workspaces — zero type errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Requires Phase 1 complete — BLOCKS all user stories
- **US1 (Phase 3)**: Requires Phase 2 complete
- **US2 (Phase 4)**: Requires Phase 2 complete; US1 and US2 can run in parallel after Phase 2
- **US3 (Phase 5)**: Requires Phase 2 complete; can run in parallel with US1/US2
- **Polish (Phase 6)**: Requires all desired user stories complete

### Within Each User Story

1. Write tests (T0XX) → confirm they FAIL
2. Implement (T0XX) → confirm tests pass
3. Checkpoint validation before moving to next story

### Parallel Opportunities

```bash
# Phase 1 — all [P] setup tasks in parallel
T004, T005, T006, T007, T008  # scaffold apps and packages simultaneously

# Phase 2 — tests before implementation, then implementation in parallel
T010, T011  # write both test files in parallel (must fail)
# then:
T012, T013, T014, T015  # implement in parallel (T012 first, others depend on its types)

# Phase 3 + 4 + 5 — all three user stories after Phase 2
T021, T022  # US1 tests in parallel
# US2 starts T028 concurrently with US1 T021-T022 if separate developer
# US3 starts T032, T033, T034, T040, T041 concurrently
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (Doctor retrieves full embryo record)
4. **STOP and VALIDATE**: `GET /api/v1/embryos/:id` with coordinator token returns correct full record
5. Coordinator can see `sex`, `chromosomal_abnormalities`, all meta fields ✅

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready
2. Phase 3 → US1 complete → coordinator can read full records ✅
3. Phase 4 → US2 complete → patient projection enforced ✅
4. Phase 5 → US3 complete → status transitions, soft-delete, validation ✅
5. Phase 6 → Production-ready ✅

### Parallel Team Strategy

With 2+ developers after Phase 2:
- Developer A: US1 (Phase 3)
- Developer B: US2 (Phase 4)
- Developer C: US3 (Phase 5)

---

## Notes

- `[P]` tasks = different files, no dependency on incomplete tasks in same phase
- Tests marked ⚠️ MUST be written first and MUST fail before implementation (Constitution Principle II)
- `embryo.projection.ts` in `apps/api` is a thin wrapper — core logic lives in `packages/schema`
- Status audit log (T036) requires a new migration file or adding columns to migration 001
- `zod-to-json-schema` (T041) is run at build time only — not a runtime dependency
