<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) → 1.0.0 — first ratification
Modified principles: N/A — initial ratification, no prior principles existed
Added sections:
  - Core Principles: I. Code Quality, II. Testing Standards,
    III. User Experience Consistency, IV. Performance Requirements
  - Performance Standards (Section 2)
  - Development Workflow (Section 3)
  - Governance
Removed sections: N/A
Templates reviewed:
  - .specify/templates/plan-template.md ✅ Constitution Check gate references principles by name; declarative principles are directly usable
  - .specify/templates/spec-template.md ✅ Success Criteria / measurable outcomes align with Performance Requirements principle; no updates needed
  - .specify/templates/tasks-template.md ✅ Polish phase includes performance optimization and testing tasks; aligned with Principles II and IV
  - .specify/templates/commands/ — no files present, skipped
Deferred TODOs:
  - TODO(PERF_BUDGET): Define concrete per-endpoint latency budgets after baseline profiling
  - TODO(COVERAGE_THRESHOLD): Define minimum test coverage percentage for the project
  - TODO(DESIGN_SYSTEM): Define or link the project design system referenced in Principle III
-->

# Embrion Constitution

## Core Principles

### I. Code Quality (NON-NEGOTIABLE)

Every unit of code MUST have a single, clearly named responsibility. All code MUST pass
static analysis, linting, and type-checking gates before review. Dead code, uncommented-out
blocks retained "just in case," and unowned TODO entries MUST NOT be merged to the main
branch. Complexity above the obvious baseline MUST be justified in the implementation plan's
Complexity Tracking table.

**Rationale**: Inconsistent code quality compounds maintenance cost exponentially and slows
onboarding. Code that cannot be read by a new contributor within minutes is a liability.

### II. Testing Standards (NON-NEGOTIABLE)

The TDD cycle MUST be followed: write a failing test → confirm it fails → implement →
confirm it passes → refactor. Unit tests are REQUIRED for all business logic. Integration
tests are REQUIRED for every external boundary (APIs, databases, third-party services,
message queues). A PR MUST NOT be merged unless all tests pass in CI and coverage meets the
project-defined threshold (TODO(COVERAGE_THRESHOLD): set threshold once baseline established).
Tests MUST run automatically on every push via the CI pipeline.

**Rationale**: Untested code is unverified code. Defects caught in tests cost orders of
magnitude less than defects caught in production.

### III. User Experience Consistency

All user-facing interfaces MUST follow the project design system
(TODO(DESIGN_SYSTEM): define or link design system once established). Interactions MUST be
predictable: the same action MUST produce the same result across all features. Error messages
MUST be human-readable and actionable — they MUST NOT expose internal stack traces or
technical identifiers to end users. Every UI change MUST include an accessibility assessment
against WCAG 2.1 AA as a PR checklist item. Deviating from an established UX pattern requires
an explicit amendment to this constitution.

**Rationale**: Inconsistent UX erodes user trust and increases support load. Predictability
is a first-class feature, not a polish concern.

### IV. Performance Requirements

Core user journeys MUST meet defined latency budgets (see Performance Standards section
below). Performance regressions MUST be flagged automatically in CI via benchmark comparison.
Every implementation plan MUST include a performance impact assessment section. Production
monitoring MUST cover at minimum p50 / p95 / p99 latency and error rates for all critical
paths.

**Rationale**: Performance is a feature. A functionally correct but unacceptably slow system
fails its users just as completely as a buggy one.

## Performance Standards

Response time budgets (authoritative — override with measured values once profiling is done):

- **API endpoints**: p95 latency MUST be < 200ms under expected load
  (TODO(PERF_BUDGET): confirm after baseline profiling)
- **Web page load**: First Contentful Paint MUST be < 2 s on a simulated 4G connection
- **Background jobs**: MUST complete within the SLA window defined in the feature spec

Memory and resource consumption constraints MUST be documented in each feature's
implementation plan. Features that introduce unbounded resource growth (e.g., in-memory
caches without eviction, polling without back-off) MUST be rejected at plan review.

## Development Workflow

Pull requests MUST:

- Reference the corresponding `spec.md` and `tasks.md` for traceability
- Pass all CI gates: lint, type-check, tests, performance regression check
- Receive at least one approving review before merge
- Include a manual test plan for any user-facing change, covering the golden path and
  relevant edge cases

Branch naming MUST follow the project convention: `###-feature-name` with sequential
numbering (managed by `/speckit-git-feature`).

Every feature MUST have `spec.md`, `plan.md`, and `tasks.md` authored and reviewed before
implementation begins. The Constitution Check gate in `plan.md` MUST be passed before
Phase 0 research proceeds.

## Governance

This constitution supersedes all other project conventions and style guides. Every
contributor MUST acknowledge the current version before beginning work on the codebase.

**Amendment procedure**:

1. Author a proposal documenting the change, rationale, and affected templates/docs.
2. Obtain approval from the project lead (or designated governance body).
3. Bump the version according to the versioning policy below.
4. Propagate changes to all dependent templates and runtime guidance files.

**Versioning policy**:

- **MAJOR**: A principle is removed, renamed, or fundamentally redefined in a
  backward-incompatible way.
- **MINOR**: A new principle or section is added, or existing guidance is materially expanded.
- **PATCH**: Clarifications, wording improvements, typo fixes, or non-semantic refinements.

**Compliance review**: All PRs and code reviews MUST verify adherence to Principles I–IV.
Reviewers MUST reject PRs that visibly violate any NON-NEGOTIABLE principle, regardless of
feature completeness.

**Version**: 1.0.0 | **Ratified**: 2026-04-30 | **Last Amended**: 2026-04-30
