# Implementation Plan: F-04 — Персонализированная подборка

**Branch**: `004-patient-selection` | **Date**: 2026-05-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/004-patient-selection/spec.md`

## Summary

Добавить к существующей инфраструктуре F-02 (patients, patient_selections, access_tokens) два coordinator-facing endpoint-а (`GET /patients` и `GET /patients/:id`) и механизм фиксации первого открытия подборки пациентом (`opened_at`). Изменения минимальны: одна миграция (ADD COLUMN), два новых метода репозитория, два новых маршрута в `auth.router.ts`, одна строка в `embryo.router.ts`.

## Technical Context

**Language/Version**: TypeScript 5.4 (strict mode) — идентично F-01/02/03
**Primary Dependencies**: Fastify 4.x, `@fastify/jwt` 8.x, `postgres` 3.x — все уже установлены; новых зависимостей нет
**Storage**: PostgreSQL 16 — один ALTER TABLE (migration 005); все остальные таблицы из F-02 не изменяются
**Testing**: Vitest + testcontainers — паттерн из F-01/02/03; 3 новых integration test-файла
**Target Platform**: Linux server (Node.js 20 LTS) — то же, что F-01/02/03
**Project Type**: Web application — monorepo backend extension
**Performance Goals**: `GET /patients` < 200ms p95 (Constitution IV); единый JOIN-запрос, без N+1; `setOpenedAt` — один UPDATE по PK (< 2ms)
**Constraints**: Нет новых зависимостей; `opened_at` — только через `UPDATE ... WHERE opened_at IS NULL` (идемпотентно); admin требует `?clinic_id=`
**Scale/Scope**: Клиника — десятки–сотни пациентов; полный список без пагинации допустим (clarified)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Статус | Обоснование |
|---------|--------|-------------|
| I. Code Quality | ✅ PASS | Каждый новый метод — одна ответственность: `setOpenedAt` (идемпотентная запись), `findEnrichedByClinic` (чтение списка), `findEnrichedById` (чтение детали). Два новых маршрута в существующем `auth.router.ts` без нового файла — не создаёт лишней абстракции. Изменение `embryo.router.ts` — одна строка в уже существующем `if (caller.role === "patient")` блоке. |
| II. Testing Standards | ✅ PASS | TDD-цикл применяется. 3 новых integration test-файла (US1/US2/US3). Unit-тесты не требуются — логика тривиальна (нет бизнес-правил сложнее условного UPDATE). Интеграционные тесты покрывают все acceptance scenarios через testcontainers. |
| III. UX Consistency | ✅ PASS (N/A) | F-04 — API-only, без UI. Сообщения об ошибках: `"Not found"` (404), `"clinic_id is required for admin"` (400) — человекочитаемые, без стек-трейсов. |
| IV. Performance | ✅ PASS | `GET /patients`: один JOIN-запрос со скалярным подзапросом, без N+1. `setOpenedAt`: один UPDATE по PK. Оба укладываются в бюджет < 200ms p95. Новых unbounded resource growth паттернов нет. |

**Post-design re-check**: ✅ All gates pass.

**Complexity Tracking (Constitution II)**: Unit-тесты отсутствуют намеренно. Вся бизнес-логика сводится к DB-запросам и одной тривиальной ветке (admin требует `?clinic_id=`). Нет вычислений, трансформаций или ветвлений, требующих изолированного покрытия. Интеграционные тесты через testcontainers покрывают все acceptance scenarios полностью.

## Project Structure

### Documentation (this feature)

```text
specs/004-patient-selection/
├── plan.md                      # This file
├── spec.md                      # Feature specification
├── research.md                  # Phase 0 — 7 decisions with rationale
├── data-model.md                # Phase 1 — migration 005, TypeScript types, repository methods
├── quickstart.md                # Phase 1 — sквозной сценарий curl
├── contracts/
│   └── patients-api.yml         # OpenAPI 3.1 — GET /patients, GET /patients/:id
├── checklists/
│   └── requirements.md          # Spec quality checklist
└── tasks.md                     # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code

```text
apps/api/
├── src/
│   ├── db/
│   │   └── migrations/
│   │       └── 005_selection_opened_at.sql          # NEW — ALTER TABLE ADD COLUMN opened_at
│   ├── middleware/
│   │   └── auth-hook.ts                             # unchanged
│   └── modules/
│       ├── auth/
│       │   ├── auth.router.ts                       # MODIFIED — add GET /patients, GET /patients/:id
│       │   ├── patient.repository.ts                # MODIFIED — add findEnrichedByClinic, findEnrichedById
│       │   └── selection.repository.ts              # MODIFIED — add setOpenedAt, update PatientSelection type
│       └── embryo/
│           └── embryo.router.ts                     # MODIFIED — trigger setOpenedAt on GET /embryos for patient
└── tests/
    └── integration/
        ├── patient-list.test.ts                     # NEW — US1: coordinator list with selection status
        ├── patient-detail.test.ts                   # NEW — US2: coordinator detail view
        ├── patient-opened-at.test.ts                # NEW — US3: opened_at end-to-end
        └── auth-route-coverage.test.ts              # MODIFIED — add new routes to PROTECTED_ROUTES
```

**Structure Decision**: Monorepo backend extension. Нет новых файлов роутеров или сервисов — все изменения additive в существующих файлах, кроме 3 новых test-файлов и 1 миграции.

---

## Phase 0: Research Decisions

Все NEEDS CLARIFICATION устранены до начала планирования. Детали — в [research.md](research.md).

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Где триггерить `opened_at` | В `embryo.router.ts` `GET /embryos` handler, не в auth-hook |
| 2 | Стратегия JOIN для обогащённого списка | Единый JOIN + скалярный подзапрос для `token_expires_at` |
| 3 | Миграция | `ALTER TABLE patient_selections ADD COLUMN opened_at TIMESTAMPTZ` |
| 4 | Схема ответа | Вложенный `selection` объект в обоих эндпоинтах (clarified) |
| 5 | Admin behaviour | `?clinic_id=` обязателен для admin (clarified) |
| 6 | Размещение маршрутов | В существующем `auth.router.ts`, без нового файла |
| 7 | setOpenedAt sync/async | `await` — синхронный (один UPDATE по PK, < 2 ms) |

---

## Phase 1: Implementation Phases

### Phase 1 — Setup & Migration (blocking)

**Single task**: Migration 005 — `ALTER TABLE patient_selections ADD COLUMN opened_at TIMESTAMPTZ`.

После выполнения все остальные фазы могут идти параллельно.

### Phase 2 — Foundation: Repository Methods (blocking prerequisite for US1/US2/US3)

Три метода, реализуемых параллельно:

1. **`selection.repository.ts`**:
   - Обновить тип `PatientSelection` — добавить `opened_at: Date | null`
   - Обновить `rowToSelection` — маппинг нового поля
   - Добавить `setOpenedAt(sql, selectionId)` — `UPDATE ... WHERE opened_at IS NULL`

2. **`patient.repository.ts`**:
   - Добавить `findEnrichedByClinic(sql, clinicId)` — JOIN-запрос, возвращает `PatientListItem[]`
   - Добавить `findEnrichedById(sql, id, clinicId?)` — JOIN-запрос, возвращает `PatientDetail | null`

### Phase 3 — User Story 1: Список пациентов (P1)

**⚠️ TDD**: Сначала тест (`patient-list.test.ts`), подтвердить FAIL, затем реализация.

- Test: `apps/api/tests/integration/patient-list.test.ts`
- Impl: `GET /api/v1/patients` в `auth.router.ts`
  - coordinator: `findEnrichedByClinic(sql, caller.clinic_id)`
  - admin без `clinic_id`: 400
  - admin с `?clinic_id=`: `findEnrichedByClinic(sql, query.clinic_id)`

### Phase 4 — User Story 2: Детальная карточка пациента (P2)

**⚠️ TDD**: Сначала тест (`patient-detail.test.ts`), подтвердить FAIL, затем реализация.

- Test: `apps/api/tests/integration/patient-detail.test.ts`
- Impl: `GET /api/v1/patients/:id` в `auth.router.ts`
  - coordinator: `findEnrichedById(sql, params.id, caller.clinic_id)` → 404 если null
  - admin: `findEnrichedById(sql, params.id)` (без clinic_id фильтра)

### Phase 5 — User Story 3: Фиксация opened_at (P2)

**⚠️ TDD**: Сначала тест (`patient-opened-at.test.ts`), подтвердить FAIL, затем реализация.

- Test: `apps/api/tests/integration/patient-opened-at.test.ts`
- Impl: В `embryo.router.ts` `GET /api/v1/embryos` handler:
  ```typescript
  if (caller.role === "patient" && caller.selection_id) {
    await selectionRepo.setOpenedAt(sql, caller.selection_id);
  }
  ```
  Добавить import `selectionRepo`.

### Phase 6 — Polish & Regression

- Обновить `auth-route-coverage.test.ts`: добавить `GET /api/v1/patients` и `GET /api/v1/patients/:id` в `PROTECTED_ROUTES`, добавить `005_selection_opened_at.sql` в `MIGRATIONS`
- Запустить `pnpm --filter @embrion/api typecheck` — zero errors
- Запустить полный тест-сюит `pnpm test`

---

## Зависимости фаз

```
Phase 1 (Migration)
    └──► Phase 2 (Repositories) ──┬──► Phase 3 (US1: List)
                                  ├──► Phase 4 (US2: Detail)
                                  └──► Phase 5 (US3: opened_at)
                                       (все три параллельно после Phase 2)
                                           └──► Phase 6 (Polish)
```

---

## Ключевые технические детали для реализации

### `findEnrichedByClinic` query pattern

```sql
SELECT
  p.id, p.name, p.clinic_id, p.created_by, p.created_at,
  ps.opened_at,
  (
    SELECT at.expires_at
    FROM access_tokens at
    WHERE at.patient_id = p.id
      AND at.revoked_at IS NULL
      AND at.expires_at > NOW()
    LIMIT 1
  ) AS token_expires_at,
  CASE WHEN ps.id IS NOT NULL THEN true ELSE false END AS has_selection
FROM patients p
LEFT JOIN patient_selections ps ON ps.patient_id = p.id
WHERE p.clinic_id = $1
ORDER BY p.created_at DESC
```

Response shape per item:
```json
{
  "id": "uuid",
  "name": "string | null",
  "clinic_id": "string",
  "created_at": "ISO8601",
  "selection": { "opened_at": "ISO8601 | null", "token_expires_at": "ISO8601 | null" } | null
}
```

(`selection: null` когда `has_selection = false`)

### `setOpenedAt` — idempotent UPDATE

```sql
UPDATE patient_selections
SET opened_at = NOW()
WHERE id = $1 AND opened_at IS NULL
```

Если `opened_at` уже установлен — UPDATE затрагивает 0 строк, никакой ошибки.

### Миграции в тестах

Все новые integration test-файлы должны включать:
```typescript
const MIGRATIONS = [
  "001_embryo_schema.sql",
  "002_embryo_status_log.sql",
  "003_auth_schema.sql",
  "004_users.sql",
  "005_selection_opened_at.sql",   // NEW
];
```

### CallerContext.selection_id

`CallerContext` для `patient` роли уже включает `selection_id` (установлен в `auth.service.ts` `validatePatientToken`). Импортировать `selectionRepo` в `embryo.router.ts` и вызывать `setOpenedAt`.
