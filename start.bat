@echo off
setlocal
title Collex Inquiries - Dev Launcher
cd /d "%~dp0"

echo ====================================================
echo   Collex Inquiries - Starting Stack
echo ====================================================
echo.

echo [1/3] Starting database and cache (PostgreSQL and Redis)...
docker compose up -d postgres redis >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] Note: Docker Compose could not start containers.
    echo     Please make sure Docker Desktop is running.
) else (
    echo [OK] PostgreSQL and Redis containers are running.
)
echo.

echo [2/3] Browser will open http://localhost:5174 shortly...
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:5174"

echo [3/3] Launching Client, API, and Queue Worker...
echo.
if not exist "server\dist\worker.js" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" -SkipBuild
)

pause
