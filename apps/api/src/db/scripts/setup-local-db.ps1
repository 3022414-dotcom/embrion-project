# setup-local-db.ps1
# Инициализация локальной базы данных для разработки.
# Запускать ОДИН РАЗ от имени пользователя с правами суперпользователя PostgreSQL.
#
# Использование:
#   .\apps\api\src\db\scripts\setup-local-db.ps1
# или с явным указанием хоста/порта:
#   .\apps\api\src\db\scripts\setup-local-db.ps1 -PgHost 127.0.0.1 -PgPort 5432

param(
    [string]$PgHost = "127.0.0.1",
    [string]$PgPort = "5432",
    [string]$PgSuperUser = "postgres"
)

$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

if (-not (Test-Path $psql)) {
    Write-Error "psql.exe не найден по пути: $psql"
    exit 1
}

Write-Host "Подключение к PostgreSQL $PgHost`:$PgPort от имени $PgSuperUser..." -ForegroundColor Cyan
Write-Host "Будет запрошен пароль суперпользователя." -ForegroundColor Yellow

$sqlScript = Join-Path $PSScriptRoot "setup-local-db.sql"

$Env:PGHOST = $PgHost
$Env:PGPORT = $PgPort

& $psql -U $PgSuperUser -f $sqlScript

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "OK. Применяем миграции схемы..." -ForegroundColor Cyan

    $migrationsDir = Join-Path $PSScriptRoot "..\migrations"
    $Env:PGPASSWORD = "embrion_dev_pw"
    $Env:PGUSER = "embrion_app"
    $Env:PGDATABASE = "embrion"

    Get-ChildItem "$migrationsDir\*.sql" | Sort-Object Name | ForEach-Object {
        Write-Host "  -> $($_.Name)"
        & $psql -f $_.FullName
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Миграция $($_.Name) завершилась с ошибкой."
            exit 1
        }
    }

    Write-Host ""
    Write-Host "Готово. База данных 'embrion' инициализирована." -ForegroundColor Green
    Write-Host "Строка подключения: postgresql://embrion_app:embrion_dev_pw@${PgHost}:${PgPort}/embrion" -ForegroundColor Green
} else {
    Write-Error "Не удалось выполнить setup-local-db.sql. Проверьте пароль суперпользователя."
    exit 1
}

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
