# Quickstart: F-04 — Персонализированная подборка

**Полный сквозной сценарий**: от создания пациента до фиксации `opened_at`.

## Предварительные условия

- Запущен API-сервер (`pnpm --filter @embrion/api dev`)
- Координатор уже аутентифицирован: `POST /api/v1/auth/login` → `COORD_TOKEN`
- Существует хотя бы один эмбрион в базе с `clinic_id = "clinic-001"` → `EMBRYO_ID`

---

## Шаг 1 — Создать пациента

```bash
PATIENT=$(curl -s -X POST http://localhost:3000/api/v1/patients \
  -H "Authorization: Bearer $COORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Анна Иванова"}')

PATIENT_ID=$(echo $PATIENT | jq -r '.id')
echo "Patient ID: $PATIENT_ID"
```

**Ожидаемый результат**: `201 Created` с `{ id, name, clinic_id, created_at }`

---

## Шаг 2 — Добавить эмбрионы в подборку

```bash
curl -s -X PATCH "http://localhost:3000/api/v1/patients/$PATIENT_ID/selection" \
  -H "Authorization: Bearer $COORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"embryo_ids\": [\"$EMBRYO_ID\"]}"
```

**Ожидаемый результат**: `200 OK` с `{ id, patient_id, embryo_ids: [...], opened_at: null }`

---

## Шаг 3 — Проверить список пациентов (до выдачи токена)

```bash
curl -s http://localhost:3000/api/v1/patients \
  -H "Authorization: Bearer $COORD_TOKEN" | jq
```

**Ожидаемый результат**:
```json
[
  {
    "id": "<PATIENT_ID>",
    "name": "Анна Иванова",
    "clinic_id": "clinic-001",
    "created_at": "...",
    "selection": {
      "opened_at": null,
      "token_expires_at": null
    }
  }
]
```

`token_expires_at: null` — токен ещё не выдан.

---

## Шаг 4 — Выдать токен пациенту

```bash
TOKEN_RESP=$(curl -s -X POST "http://localhost:3000/api/v1/patients/$PATIENT_ID/token" \
  -H "Authorization: Bearer $COORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttl_days": 30}')

PATIENT_TOKEN=$(echo $TOKEN_RESP | jq -r '.tokenValue')
echo "Patient token: $PATIENT_TOKEN"
```

**Ожидаемый результат**: `201 Created` с `{ tokenValue, expiresAt }`

---

## Шаг 5 — Пациент открывает подборку (первое использование токена)

```bash
curl -s http://localhost:3000/api/v1/embryos \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq
```

**Ожидаемый результат**: `200 OK` — массив только из эмбрионов подборки. `opened_at` в БД устанавливается в текущее время.

---

## Шаг 6 — Координатор видит, что подборка открыта

```bash
curl -s "http://localhost:3000/api/v1/patients/$PATIENT_ID" \
  -H "Authorization: Bearer $COORD_TOKEN" | jq '.selection'
```

**Ожидаемый результат**:
```json
{
  "embryo_ids": ["<EMBRYO_ID>"],
  "opened_at": "2026-05-10T14:30:00.000Z",
  "token_expires_at": "2026-06-09T14:30:00.000Z"
}
```

`opened_at` заполнен — пациент открыл подборку.

---

## Шаг 7 — Второй просмотр не перезаписывает `opened_at`

```bash
# Пациент снова открывает подборку
curl -s http://localhost:3000/api/v1/embryos \
  -H "Authorization: Bearer $PATIENT_TOKEN" > /dev/null

# Проверяем — opened_at не изменился
curl -s "http://localhost:3000/api/v1/patients/$PATIENT_ID" \
  -H "Authorization: Bearer $COORD_TOKEN" | jq '.selection.opened_at'
```

**Ожидаемый результат**: То же значение, что и в шаге 6.

---

## Admin — список пациентов конкретной клиники

```bash
# Без clinic_id — 400
curl -s http://localhost:3000/api/v1/patients \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → {"error": "clinic_id is required for admin"}

# С clinic_id — список пациентов клиники
curl -s "http://localhost:3000/api/v1/patients?clinic_id=clinic-001" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```
