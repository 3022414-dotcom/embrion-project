# Tasks: F-04 — Персонализированная подборка

**Input**: Design documents from `specs/004-patient-selection/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/patients-api.yml ✅ quickstart.md ✅

**TDD approach**: Тесты пишутся первыми, подтверждаются FAIL до реализации, затем реализация.

---

## Phase 1: Setup

**Purpose**: Единственное изменение схемы — ALTER TABLE. Блокирует все остальные фазы.

- [X] T001 Create `apps/api/src/db/migrations/005_selection_opened_at.sql` — одна строка: `ALTER TABLE patient_selections ADD COLUMN opened_at TIMESTAMPTZ;` с комментарием `COMMENT ON COLUMN patient_selections.opened_at IS 'Timestamp of first patient access. NULL until patient opens selection.';`

**Checkpoint**: `pnpm --filter @embrion/api build` не ломается; миграция применима к чистой БД.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Два репозиторных метода, от которых зависят все три user story. Реализуются параллельно — разные файлы.

**⚠️ CRITICAL**: US1, US2, US3 не могут начаться до завершения этой фазы.

- [X] T002 [P] Update `apps/api/src/modules/auth/selection.repository.ts` — три изменения: (1) добавить `opened_at: Date | null` в интерфейс `PatientSelection`; (2) добавить маппинг `opened_at: (row["opened_at"] as Date | null) ?? null` в функцию `rowToSelection`; (3) добавить экспортируемую функцию `setOpenedAt(sql: Sql, selectionId: string): Promise<void>` с SQL `UPDATE patient_selections SET opened_at = NOW() WHERE id = ${selectionId} AND opened_at IS NULL` — идемпотентно, не перезаписывает при повторных вызовах

- [X] T003 [P] Update `apps/api/src/modules/auth/patient.repository.ts` — добавить два новых метода: (1) `findEnrichedByClinic(sql: Sql, clinicId: string): Promise<PatientListItem[]>` — JOIN-запрос: `SELECT p.id, p.name, p.clinic_id, p.created_at, ps.opened_at, ps.id IS NOT NULL AS has_selection, (SELECT at.expires_at FROM access_tokens at WHERE at.patient_id = p.id AND at.revoked_at IS NULL AND at.expires_at > NOW() LIMIT 1) AS token_expires_at FROM patients p LEFT JOIN patient_selections ps ON ps.patient_id = p.id WHERE p.clinic_id = ${clinicId} ORDER BY p.created_at DESC`; маппер возвращает `{ id, name, clinic_id, created_at, selection: has_selection ? { opened_at, token_expires_at } : null }`; (2) `findEnrichedById(sql: Sql, id: string, clinicId?: string): Promise<PatientDetail | null>` — тот же паттерн, `WHERE p.id = ${id}` плюс `AND p.clinic_id = ${clinicId}` если clinicId передан; маппер добавляет `selection.embryo_ids` из `ps.embryo_ids`; возвращает null если строк 0. Добавить типы `PatientListItem` и `PatientDetail` в файл.

**Checkpoint**: `pnpm --filter @embrion/api typecheck` проходит без ошибок.

---

## Phase 3: User Story 1 — Список пациентов координатора (Priority: P1) 🎯 MVP

**Goal**: `GET /api/v1/patients` возвращает список пациентов клиники с состоянием подборки.

**Independent Test**: Coordinator JWT → GET /patients → массив с вложенным `selection` объектом. Admin без clinic_id → 400.

### Тесты — написать первыми, должны УПАСТЬ ⚠️

- [X] T004 [US1] Write `apps/api/tests/integration/patient-list.test.ts` — миграции: 001, 003, 004, 005; вставить координатора (`coord-1`, `clinic-a`) в users; тесты: (1) coordinator GET /patients → 200, массив с `selection: { opened_at: null, token_expires_at: null }` для пациента без токена; (2) пациент без подборки → `selection: null`; (3) после выдачи токена (`POST /patients/:id/token`) → `selection.token_expires_at` заполнен; (4) coordinator клиники B не видит пациентов клиники A; (5) 0 пациентов → пустой массив `[]`, не ошибка; (6) admin без `?clinic_id=` → 400 `{ error: "clinic_id is required for admin" }`; (7) admin с `?clinic_id=clinic-a` → список пациентов clinic-a; (8) запрос без авторизации → 401. Должен УПАСТЬ до реализации T005.

### Реализация

- [X] T005 [US1] Add `GET /api/v1/patients` to `apps/api/src/modules/auth/auth.router.ts` — после существующих маршрутов; preHandler: `requireRole("coordinator", "admin")`; логика: если `caller.role === "coordinator"` → `findEnrichedByClinic(sql, caller.clinic_id)`; если `caller.role === "admin"` → проверить `(request.query as { clinic_id?: string }).clinic_id`; если отсутствует → `reply.status(400).send({ error: "clinic_id is required for admin" })`; иначе → `findEnrichedByClinic(sql, query.clinic_id)`; вернуть массив с `reply.send(patients)`.

- [ ] T006 [US1] Run `apps/api/tests/integration/patient-list.test.ts` — должен пройти. Исправить до зелёного состояния.

**Checkpoint**: `GET /api/v1/patients` функционирует. Изоляция по клиникам работает. Admin с clinic_id фильтром работает. ✅ US1 независимо тестируем.

---

## Phase 4: User Story 2 — Детальная карточка пациента (Priority: P2)

**Goal**: `GET /api/v1/patients/:id` возвращает полное состояние подборки включая `embryo_ids`.

**Independent Test**: GET /patients/:id → `selection.embryo_ids` массив, `opened_at`, `token_expires_at`. Пациент другой клиники → 404.

### Тесты — написать первыми, должны УПАСТЬ ⚠️

- [X] T007 [US2] Write `apps/api/tests/integration/patient-detail.test.ts` — миграции: 001, 003, 004, 005; вставить координатора в users; тесты: (1) GET /patients/:id с подборкой из 2 эмбрионов → 200, `selection.embryo_ids.length === 2`, `selection.opened_at: null`, `selection.token_expires_at: null`; (2) после выдачи токена → `selection.token_expires_at` заполнен; (3) пациент без подборки → `selection: null`; (4) пациент другой клиники → 404; (5) несуществующий id → 404; (6) запрос без авторизации → 401. Должен УПАСТЬ до реализации T008.

### Реализация

- [X] T008 [US2] Add `GET /api/v1/patients/:id` to `apps/api/src/modules/auth/auth.router.ts` — после маршрута GET /patients из T005; preHandler: `requireRole("coordinator", "admin")`; логика: если `caller.role === "coordinator"` → `findEnrichedById(sql, params.id, caller.clinic_id)`; если admin → `findEnrichedById(sql, params.id)` (без clinic фильтра); если null → `reply.status(404).send({ error: "Not found" })`; иначе `reply.send(patient)`.

- [ ] T009 [US2] Run `apps/api/tests/integration/patient-detail.test.ts` — должен пройти. Исправить до зелёного состояния.

**Checkpoint**: GET /patients/:id возвращает полный объект. 404 для чужих клиник. ✅ US2 независимо тестируем.

---

## Phase 5: User Story 3 — Фиксация первого открытия подборки (Priority: P2)

**Goal**: Первый `GET /api/v1/embryos` пациентом устанавливает `opened_at`. Повторные вызовы не перезаписывают.

**Independent Test**: Полный сквозной путь: создать пациента → добавить эмбрионы → выдать токен → GET /embryos с токеном → GET /patients/:id видит `opened_at` заполненным.

**Note**: US3 можно реализовывать параллельно с US1/US2 — затрагивает другой файл (`embryo.router.ts`).

### Тесты — написать первыми, должны УПАСТЬ ⚠️

- [X] T010 [US3] Write `apps/api/tests/integration/patient-opened-at.test.ts` — миграции: 001, 002, 003, 004, 005; вставить координатора в users; в `beforeAll` вставить один эмбрион в таблицу `embryos` (clinic_id совпадает с координатором) и добавить его в подборку пациента — необходимо для теста (4) GET /embryos/:id; тесты: (1) сквозной: создать пациента → PATCH selection с 2 эмбрионами → POST token → GET /embryos с токеном пациента → GET /patients/:id показывает `selection.opened_at` НЕ null; (2) до первого GET /embryos → `opened_at: null`; (3) второй GET /embryos → `opened_at` не изменился (равен первому значению); (4) GET /embryos/:id с токеном пациента НЕ устанавливает `opened_at` (проверить что после только GET by ID — `opened_at` остаётся null); (5) истёкший токен → 401, `opened_at` не изменяется; (6) PATCH /patients/:id/selection (обновление embryo_ids после первого открытия) → GET /patients/:id показывает `opened_at` неизменным; (7) POST /patients/:id/token повторно (перевыдача токена) → GET /patients/:id показывает `opened_at` неизменным. Должен УПАСТЬ до реализации T011.

### Реализация

- [X] T011 [US3] Modify `apps/api/src/modules/embryo/embryo.router.ts` — два изменения: (1) добавить импорт в начало файла: `import * as selectionRepo from "../auth/selection.repository.js"`; (2) в обработчике `GET /api/v1/embryos`, после строки `const embryos = await service.list(...)` и перед `return reply.send(...)`, добавить блок: `if (caller.role === "patient" && caller.selection_id) { await selectionRepo.setOpenedAt(sql, caller.selection_id); }` — использует уже существующий `caller.selection_id` из CallerContext.

- [ ] T012 [US3] Run `apps/api/tests/integration/patient-opened-at.test.ts` — должен пройти. Исправить до зелёного состояния.

**Checkpoint**: Первый просмотр фиксируется. Повторный не перезаписывает. GET by ID не триггерит. ✅ US3 независимо тестируем.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Покрытие маршрутов, типизация, регрессия F-01/F-02/F-03.

- [X] T013 Update `apps/api/tests/integration/auth-route-coverage.test.ts` — два изменения: (1) добавить `join(__dirname, "../../src/db/migrations/005_selection_opened_at.sql")` в массив `MIGRATIONS` после `004_users.sql`; (2) добавить в массив `PROTECTED_ROUTES`: `["GET", "/api/v1/patients"]` и `["GET", "/api/v1/patients/:id"]`

- [X] T014 [P] Run `pnpm --filter @embrion/api typecheck` (`tsc --noEmit`) — zero type errors. Проверить: типы `PatientListItem`, `PatientDetail` в `patient.repository.ts`; `opened_at` в `PatientSelection`; `caller.selection_id` в `embryo.router.ts`.

- [ ] T015 Run full test suite `pnpm test` — все тесты проходят, включая регрессию F-01/F-02/F-03. Проверить что изменение `embryo.router.ts` не сломало существующие тесты.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Без зависимостей — начать немедленно
- **Phase 2 (Foundation)**: Требует Phase 1 — **БЛОКИРУЕТ все user story фазы**
- **Phase 3 (US1)**: Требует Phase 2 — единственная P1 история
- **Phase 4 (US2)**: Требует Phase 3 (оба затрагивают `auth.router.ts`)
- **Phase 5 (US3)**: Требует Phase 2 — **может выполняться параллельно с Phase 3 и 4** (разные файлы)
- **Phase 6 (Polish)**: Требует завершения всех user story фаз

### User Story Dependencies

- **US1 (P1)**: Зависит только от Phase 2
- **US2 (P2)**: Зависит от US1 (тот же файл `auth.router.ts` — конфликт редактирования)
- **US3 (P2)**: Зависит только от Phase 2 — независим от US1/US2 (разные файлы)

### Within Each Phase

1. Тесты (T004/T007/T010) → подтвердить FAIL
2. Реализация (T005/T008/T011)
3. Запуск тестов (T006/T009/T012) → подтвердить PASS
4. Checkpoint перед следующей фазой

### Parallel Opportunities

- T002 и T003 — параллельно (разные файлы)
- T004 (тест US1) и T010 (тест US3) — параллельно (разные файлы)
- T005 (impl US1) и T011 (impl US3) — параллельно (разные файлы)
- T013 и T014 — параллельно

---

## Parallel Example: Phase 2 Foundation

```bash
# Параллельно — разные файлы:
Task T002: apps/api/src/modules/auth/selection.repository.ts
Task T003: apps/api/src/modules/auth/patient.repository.ts

# После Phase 2 — US1 и US3 параллельно:
Task T004: apps/api/tests/integration/patient-list.test.ts (US1 test)
Task T010: apps/api/tests/integration/patient-opened-at.test.ts (US3 test)

# Реализация US1 и US3 параллельно:
Task T005: apps/api/src/modules/auth/auth.router.ts (US1)
Task T011: apps/api/src/modules/embryo/embryo.router.ts (US3)
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Phase 1: Миграция 005
2. Phase 2: Репозиторные методы
3. Phase 3: GET /patients
4. **STOP and VALIDATE**: `GET /api/v1/patients` с токеном координатора → список пациентов с `selection` объектами
5. US2 и US3 добавляются инкрементально

### Incremental Delivery

1. Setup + Foundation → типы и запросы готовы
2. US1 → GET /patients live (MVP)
3. US2 → GET /patients/:id live
4. US3 → opened_at трекинг live
5. Polish → регрессия и покрытие маршрутов

### Notes

- `[P]` задачи = разные файлы, нет зависимостей — безопасно параллелить
- `[USN]` метка связывает задачу с user story для трассируемости
- T002 и T003 полностью независимы — начинать параллельно
- US3 (T010–T012) может идти параллельно с US1 и US2 — `embryo.router.ts` vs `auth.router.ts`
- При добавлении миграций в тест-файлы: порядок 001, 003, 004, 005 (002 нужна только для embryo status тестов)
- Все тесты требуют вставки пользователя в таблицу `users` (паттерн из F-03)
