@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  PermaTrax — stop everything started by start.bat.
REM  Idempotent: safe to run when nothing is running.
REM ─────────────────────────────────────────────────────────────────────────────
title PermaTrax Stop
echo Stopping PermaTrax platform...

echo   Stopping Docker services...
docker-compose down >nul 2>&1

echo   Killing Node.js processes on ports 3000 / 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo   Killing ngrok agent ^(any tunnels + dashboard 4040^)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4040 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
taskkill /F /IM ngrok.exe /T >nul 2>&1

echo Done. All services stopped.
pause
