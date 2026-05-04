# Embrion — Платформа подбора эмбрионов

Монорепозиторий веб-приложения для клиник репродуктивной медицины.  
Система управляет каталогом эмбрионов с ролевой моделью доступа: данные фильтруются
в зависимости от роли запрашивающей стороны — пациент видит только то, что ему положено.

---

## Содержание

- [Структура репозитория](#структура-репозитория)
- [Требования](#требования)
- [Установка](#установка)
- [Конфигурация](#конфигурация)
- [Запуск](#запуск)
- [Тесты](#тесты)
- [API](#api)
- [Ролевая модель](#ролевая-модель)
- [Статусная машина эмбриона](#статусная-машина-эмбриона)
- [Разработка](#разработка)

---

## Структура репозитория

```
embrion-project/
├── apps/
│   ├── api/                    # Fastify REST API (Node.js)
│   │   ├── src/
│   │   │   ├── app.ts          # Фабрика Fastify-приложения
│   │   │   ├── index.ts        # Точка входа (HTTP-сервер)
│   │   │   ├── db/migrations/  # SQL-миграции PostgreSQL
│   │   │   └── modules/embryo/ # Маршруты, сервис, репозиторий
│   │   └── tests/
│   │       ├── integration/    # Тесты с реальной БД (testcontainers)
│   │       ├── unit/           # Юнит-тесты без БД
│   │       └── helpers/        # JWT-утилиты для тестов
│   └── web/                    # React + Vite фронтенд
│       └── src/types/embryo.ts # Экспорт типов из @embrion/schema
├── packages/
│   └── schema/                 # Общий пакет — типы, Zod-схемы, видимость
│       ├── src/
│       │   ├── embryo.types.ts    # TypeScript-типы
│       │   ├── embryo.schema.ts   # Zod-схемы + наследование фенотипа
│       │   ├── embryo.visibility.ts # Матрица ролей + projectEmbryo()
│       │   ├── embryo.manifest.ts  # Версия схемы (semver)
│       │   └── index.ts           # Barrel-экспорт
│       └── tests/
├── specs/                      # Проектная документация (Spec Kit)
│   └── 001-embryo-data-model/
│       ├── spec.md             # Требования
│       ├── plan.md             # Технический план
│       ├── data-model.md       # Модель данных + матрица ролей
│       ├── contracts/          # OpenAPI 3.1 + JSON Schema
│       └── tasks.md            # Чеклист задач
├── package.json                # Корневой манифест (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo pipeline
└── tsconfig.base.json          # Базовый TypeScript-конфиг
```

---

## Требования

| Инструмент | Минимальная версия |
|------------|-------------------|
| Node.js    | 20.x              |
| pnpm       | 9.x               |
| PostgreSQL  | 16.x              |
| Docker     | 24.x *(только для интеграционных тестов)* |

---

## Установка

```bash
# Клонировать репозиторий
git clone <repo-url>
cd embrion-project

# Установить зависимости всех пакетов
pnpm install

# Собрать общий пакет схемы (требуется перед первым запуском API и веба)
pnpm --filter @embrion/schema build
```

---

## Конфигурация

API-сервер настраивается через переменные окружения.  
Создайте файл `apps/api/.env` (он исключён из git):

```dotenv
# Строка подключения к PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/embrion

# Секрет для подписи JWT-токенов (обязательно замените в production)
JWT_SECRET=your-very-long-random-secret-here

# Порт HTTP-сервера (по умолчанию 3000)
PORT=3000
```

### Значения по умолчанию

| Переменная     | Умолчание                              | Описание                    |
|----------------|----------------------------------------|-----------------------------|
| `DATABASE_URL` | `postgresql://localhost/embrion`       | Строка подключения к БД     |
| `JWT_SECRET`   | `change-me-in-production`              | Секрет подписи токенов      |
| `PORT`         | `3000`                                 | Порт API-сервера            |

> **Важно**: никогда не используйте значения по умолчанию в production-окружении.

---

## Запуск

### Режим разработки

```bash
# Запустить API и веб одновременно (с hot-reload)
pnpm dev

# Или по отдельности:
pnpm --filter @embrion/api dev       # API на http://localhost:3000
pnpm --filter @embrion/web dev       # Веб на http://localhost:5173
```

### Production

```bash
# 1. Собрать все пакеты
pnpm build

# 2. Применить миграции к базе данных (выполняется разово / при обновлении)
psql "$DATABASE_URL" -f apps/api/src/db/migrations/001_embryo_schema.sql
psql "$DATABASE_URL" -f apps/api/src/db/migrations/002_embryo_status_log.sql

# 3. Запустить API-сервер
node apps/api/dist/index.js
```

---

## Тесты

### Юнит-тесты (без базы данных)

```bash
# Тесты пакета схемы (44 теста, покрытие 100%)
pnpm --filter @embrion/schema test

# Тесты проекции ролей в API (5 тестов)
pnpm --filter @embrion/api exec vitest run tests/unit

# Все юнит-тесты через Turborepo
pnpm test
```

### Тесты с покрытием

```bash
pnpm --filter @embrion/schema test:coverage
```

Пороговые значения: **ветви ≥ 90 %**, **функции ≥ 95 %**, **строки ≥ 90 %**.

### Интеграционные тесты (требуется Docker)

Тесты поднимают реальный PostgreSQL 16 через [testcontainers](https://testcontainers.com/).

```bash
# Убедитесь, что Docker запущен, затем:
pnpm --filter @embrion/api exec vitest run tests/integration

# Или отдельный сценарий:
pnpm --filter @embrion/api exec vitest run tests/integration/embryo-get.test.ts
```

Файлы интеграционных тестов:

| Файл | Что проверяет |
|------|---------------|
| `embryo-get.test.ts` | GET /embryos, GET /embryos/:id, /schema/manifest |
| `embryo-patient-projection.test.ts` | Фильтрация полей для пациента |
| `embryo-status.test.ts` | Переходы статусов, 403 для пациента |
| `embryo-create.test.ts` | POST /embryos, валидация, производный фенотип |
| `embryo-update.test.ts` | PATCH /embryos/:id, запрет изменения статуса |
| `embryo-delete.test.ts` | Мягкое удаление, анонимизация донора |
| `embryo-validation.test.ts` | Ошибки валидации, 400/403 |
| `embryo.repository.test.ts` | Слой репозитория напрямую |

---

## API

Базовый URL: `/api/v1`  
Аутентификация: `Authorization: Bearer <JWT>`

JWT-токен должен содержать поле `role` со значением `patient`, `coordinator` или `admin`.

| Метод  | Путь                       | Роли                  | Описание                              |
|--------|----------------------------|-----------------------|---------------------------------------|
| POST   | `/embryos`                 | coordinator, admin    | Создать запись эмбриона               |
| GET    | `/embryos`                 | все                   | Список эмбрионов (поля по роли)       |
| GET    | `/embryos/:id`             | все                   | Получить запись (поля по роли)        |
| PATCH  | `/embryos/:id`             | coordinator, admin    | Обновить поля (не статус)             |
| PATCH  | `/embryos/:id/status`      | coordinator, admin    | Изменить статус по FSM                |
| POST   | `/embryos/:id/delete`      | admin                 | Мягкое удаление + анонимизация донора |
| GET    | `/schema/manifest`         | все                   | Текущая версия схемы и changelog      |

Полная спецификация: [`specs/001-embryo-data-model/contracts/embryo-api.yml`](specs/001-embryo-data-model/contracts/embryo-api.yml) (OpenAPI 3.1).

---

## Ролевая модель

Сервер автоматически фильтрует поля ответа в зависимости от роли из JWT.  !
Ограниченные поля **отсутствуют** в ответе (не возвращаются как `null`).

| Поле | Пациент | Координатор | Администратор |
|------|:-------:|:-----------:|:-------------:|
| `id`, `creation_date`, `clinic_id` | ✗ | ✓ | ✓ |
| `sex` | ✗ | ✓ | ✓ |
| Все поля донора (`egg_donor.*`, `sperm_donor.*`) | ✓ | ✓ | ✓ |
| `phenotype.*` | ✓ | ✓ | ✓ |
| `genetics.screening_status` | ✓ | ✓ | ✓ |
| `genetics.chromosomal_abnormalities`, `risk_factors` | ✗ | ✓ | ✓ |
| `medical.*` | ✓ | ✓ | ✓ |
| `matching.compatible_blood_types` | ✓ | ✓ | ✓ |
| `matching.notes` | ✗ | ✓ | ✓ |
| `meta.*` (версия схемы, приоритет и т.д.) | ✗ | ✓ | ✓ |
| `meta.deleted_at` | ✗ | ✗ | ✓ |

Логика проекции реализована в [`packages/schema/src/embryo.visibility.ts`](packages/schema/src/embryo.visibility.ts).

---

## Статусная машина эмбриона

```
available ──reserve──► reserved
    │                      │
    │ use (прямое)          │ use
    │                      │
    └──────────────────► used  (терминальный — переходов нет)
    
reserved ──release──► available
```

Переходы разрешены только ролям **coordinator** и **admin**.  
Попытка пациента изменить статус → `403 Forbidden`.  
Переход из `used` в любое состояние → `400 Bad Request`.

---

## Разработка

### Полезные команды

```bash
# Проверка типов всех пакетов
pnpm typecheck

# Сборка конкретного пакета
pnpm --filter @embrion/schema build
pnpm --filter @embrion/api build

# Сгенерировать JSON Schema из Zod-схемы
pnpm --filter @embrion/schema generate:json-schema

# Очистка артефактов сборки
pnpm clean
```

### Структура пакета `@embrion/schema`

Общий пакет импортируется и в API, и в веб:

```typescript
import {
  EmbryoSchema,        // Zod-схема полного объекта
  CreateEmbryoSchema,  // Zod-схема для создания (с наследованием фенотипа)
  projectEmbryo,       // Проекция по роли: projectEmbryo("patient", embryo)
  SCHEMA_MANIFEST,     // { current_version, changelog }
} from "@embrion/schema";
```

### Наследование фенотипа

При создании записи, если поля `phenotype` не переданы, сервер выводит их из данных доноров:

| Поле фенотипа | Правило |
|---------------|---------|
| `eye_color` | Доминантный цвет (коричневый > карий > зелёный > голубой/серый) |
| `hair_color` | Более тёмный цвет (чёрный > тёмно-коричневый > ... > блондин) |
| `height_range` | `{ min: ⌊(яйцо + сперма) / 2⌋ − 5, max: ⌈(яйцо + сперма) / 2⌉ + 5 }` (см) |
| `skin_tone` | Более тёмный из двух доноров, иначе `null` |

### Мягкое удаление

`POST /embryos/:id/delete` (только admin):
- Устанавливает `meta.deleted_at` = текущее время UTC
- Обнуляет все поля `egg_donor.*`, `sperm_donor.*`, `phenotype.*`
- Сохраняет медицинские данные (`medical.*`, `genetics.*`)
- Удалённые записи исключаются из выдачи для пациентов и координаторов

### Версионирование схемы

Схема данных версионируется по [semver](https://semver.org/).  
Текущая версия: **1.0.0** — [`packages/schema/src/embryo.manifest.ts`](packages/schema/src/embryo.manifest.ts).  
Каждая запись эмбриона хранит поле `meta.schema_version`.

---

## Документация

| Документ | Путь |
|----------|------|
| Требования (spec) | [`specs/001-embryo-data-model/spec.md`](specs/001-embryo-data-model/spec.md) |
| Технический план | [`specs/001-embryo-data-model/plan.md`](specs/001-embryo-data-model/plan.md) |
| Модель данных | [`specs/001-embryo-data-model/data-model.md`](specs/001-embryo-data-model/data-model.md) |
| OpenAPI 3.1 | [`specs/001-embryo-data-model/contracts/embryo-api.yml`](specs/001-embryo-data-model/contracts/embryo-api.yml) |
| JSON Schema | [`specs/001-embryo-data-model/contracts/embryo.schema.json`](specs/001-embryo-data-model/contracts/embryo.schema.json) |
