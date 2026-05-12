# Research: F-04 — Персонализированная подборка

**Branch**: `004-patient-selection` | **Date**: 2026-05-08

## Decision 1 — Где триггерить `opened_at`

**Decision**: В обработчике `GET /api/v1/embryos` в `embryo.router.ts`, а не в `auth-hook.ts`.

**Rationale**: Спецификация (clarification) явно ограничивает триггер: только GET /embryos (список), не GET /embryos/:id и не другие маршруты. Auth-hook запускается для всех эндпоинтов, поэтому там нельзя различить LIST vs GET by ID без анализа URL — это нарушило бы принцип единственной ответственности (Constitution I). Embryo router уже проверяет `caller.role === "patient"` для фильтрации по `embryo_ids`; добавить `setOpenedAt` в тот же блок — естественное место.

**Implementation**: После получения списка эмбрионов, если `caller.role === "patient"` и `caller.selection_id` присутствует:
```
await selectionRepo.setOpenedAt(sql, caller.selection_id)
```
Метод использует `UPDATE ... SET opened_at = NOW() WHERE id = $1 AND opened_at IS NULL` — идемпотентен, race-condition-safe.

**Alternatives considered**:
- Auth-hook: отклонён — не различает конкретный маршрут
- `validatePatientToken` в auth.service.ts: отклонён — сервис авторизации не должен знать о бизнес-событии "подборка просмотрена"

---

## Decision 2 — Стратегия JOIN для обогащённого списка пациентов

**Decision**: Один SQL-запрос с `LEFT JOIN patient_selections` и скалярным подзапросом для `token_expires_at`.

**Rationale**: N+1 запросов при сотнях пациентов нежелателен (Constitution IV). LEFT JOIN с `access_tokens` технически возможен, но опирается на инвариант "не более 1 активного токена на пациента" — инвариант верен (revokeByPatientId при выдаче нового токена), но хрупок. Скалярный подзапрос `(SELECT expires_at FROM access_tokens WHERE patient_id = p.id AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1)` явно ограничивает результат одной строкой и безопасен независимо от инварианта.

**Query pattern** (для `findEnrichedByClinic`):
```sql
SELECT
  p.id, p.name, p.clinic_id, p.created_by, p.created_at,
  ps.opened_at,
  ps.embryo_ids,
  (SELECT expires_at FROM access_tokens at
   WHERE at.patient_id = p.id
     AND at.revoked_at IS NULL
     AND at.expires_at > NOW()
   LIMIT 1) AS token_expires_at
FROM patients p
LEFT JOIN patient_selections ps ON ps.patient_id = p.id
WHERE p.clinic_id = $1
ORDER BY p.created_at DESC
```

Для детального `findEnrichedById` — тот же паттерн без `WHERE clinic_id` (id однозначен); clinic_id фильтр опционален (для coordinator — обязателен, для admin — пропускается).

**Alternatives considered**:
- N+1 (3 отдельных запроса на пациента): отклонён — не масштабируется
- LEFT JOIN access_tokens: возможен, но субзапрос безопаснее

---

## Decision 3 — Миграция `opened_at`

**Decision**: `ALTER TABLE patient_selections ADD COLUMN opened_at TIMESTAMPTZ` (migration 005).

**Rationale**: Минимальное изменение схемы. `DEFAULT NULL` — явный по умолчанию для TIMESTAMPTZ; все существующие записи получат NULL (интерпретируется как "не открывалась"). Нет необходимости в backfill.

**Migration file**: `005_selection_opened_at.sql`

**Alternatives considered**:
- Деривировать `opened_at` из `token_audit_log WHERE event = 'used'`: отклонён — требует агрегирующего запроса на каждый вызов, сложнее и медленнее; прямое поле проще и быстрее (Constitution I, IV)

---

## Decision 4 — Схема ответа: вложенный объект `selection`

**Decision**: Единая вложенная схема `selection: { opened_at, token_expires_at } | null` для списка и `selection: { embryo_ids, opened_at, token_expires_at } | null` для детали.

**Rationale**: Уточнено в clarifications (Q1 сессии 2026-05-08). Согласованность схемы упрощает потребление на фронтенде — одна TypeScript-модель для обоих эндпоинтов.

---

## Decision 5 — Admin: обязательный `?clinic_id=`

**Decision**: `GET /api/v1/patients` для роли `admin` требует query-параметра `?clinic_id=`; без него — 400. `GET /api/v1/patients/:id` — не требует (id однозначен).

**Rationale**: Уточнено в clarifications (Q2 сессии 2026-05-08). Возвращать все записи всех клиник без фильтра небезопасно и нарушает принцип наименьшего привилегирования.

---

## Decision 6 — Размещение новых GET-маршрутов

**Decision**: Добавить `GET /api/v1/patients` и `GET /api/v1/patients/:id` в существующий `auth.router.ts` (не создавать отдельный роутер).

**Rationale**: Все endpoint-ы ресурса `patients` уже в одном файле; разбиение создаст избыточную абстракцию для учебного проекта (Constitution I — no complexity beyond what the task requires).

---

## Decision 7 — setOpenedAt: sync vs fire-and-forget

**Decision**: `await selectionRepo.setOpenedAt(...)` — синхронный вызов, включён в ответ клиенту.

**Rationale**: Вызов — один UPDATE по индексированному PK (< 2 ms). Fire-and-forget сложнее в обработке ошибок и тестировании. Для учебного проекта синхронный вызов оптимален.
