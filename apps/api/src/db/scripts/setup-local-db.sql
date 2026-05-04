-- setup-local-db.sql
-- Выполняется ОДИН РАЗ от имени суперпользователя (postgres).
-- Создаёт прикладного пользователя и базу данных для локальной разработки.
-- Запуск:
--   psql -U postgres -f apps/api/src/db/scripts/setup-local-db.sql

-- 1. Создать пользователя приложения (если не существует)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'embrion_app') THEN
    CREATE ROLE embrion_app
      WITH LOGIN
      PASSWORD 'embrion_dev_pw'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'Role embrion_app created.';
  ELSE
    RAISE NOTICE 'Role embrion_app already exists — skipped.';
  END IF;
END
$$;

-- 2. Создать базу данных (если не существует)
SELECT 'CREATE DATABASE embrion OWNER embrion_app ENCODING ''UTF8'' LC_COLLATE ''en_US.UTF-8'' LC_CTYPE ''en_US.UTF-8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'embrion')\gexec

-- 3. Подключиться к БД и выдать привилегии
\connect embrion

GRANT ALL PRIVILEGES ON DATABASE embrion TO embrion_app;
GRANT ALL ON SCHEMA public TO embrion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO embrion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO embrion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TYPES TO embrion_app;

\echo '--------------------------------------------'
\echo 'Database "embrion" is ready.'
\echo 'User:     embrion_app'
\echo 'Password: embrion_dev_pw  (см. apps/api/.env)'
\echo '--------------------------------------------'
