@echo off
title Collex Inquiries - Stop Services
cd /d "%~dp0"

echo ====================================================
echo   Collex Inquiries - Stopping Services
echo ====================================================
echo.

echo [1/2] Stopping Node.js processes for Collex Inquiries...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = (Get-Location).Path; $all = @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"); foreach($p in $all){ if($p.CommandLine -and $p.CommandLine.Contains($root)){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }"

echo [2/2] Stopping Docker containers (PostgreSQL and Redis)...
docker compose stop postgres redis >nul 2>&1

echo.
echo [OK] All Collex Inquiries services have been stopped.
timeout /t 3
