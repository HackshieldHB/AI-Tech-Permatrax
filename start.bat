@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  PermaTrax — one-command dev launcher
REM
REM  USAGE
REM      start.bat                   Local dev (FE :3000; API direct :3001 on localhost only)
REM      start.bat --with-ngrok      Single ngrok tunnel -> Next :3000; /api proxied to Nest
REM      start.bat ngrok             (alias)
REM
REM  ORDER OF OPERATIONS
REM      0. Pre-clean ports 3000 / 3001 / 4040 and any stale ngrok.exe.
REM      1. docker-compose up -d         (Postgres + Redis)
REM      2. prisma migrate deploy
REM      3. Start backend (pnpm start:dev) in a new window
REM      4. Poll http://127.0.0.1:3001/api/health until 200 (hard-fail at 60 s)
REM      5. With --with-ngrok: start Next.js, WAIT until :3000 responds, THEN ngrok (single tunnel -> :3000).
REM         Without ngrok: write localhost env, then start Next.js.
REM      6. Summary
REM
REM  WHY THIS DESIGN
REM      - Ngrok must start AFTER Next is listening so / and /api/* hit the dev server.
REM      - All paths are relative to %~dp0 — repo can move.
REM      - Pre-clean makes reruns safe; no "port already in use" zombies.
REM      - Backend health is polled, not slept; hard fail if it never returns 200.
REM      - Ngrok lives in ONE script (start-ngrok.ps1), not duplicated here.
REM ─────────────────────────────────────────────────────────────────────────────

setlocal EnableDelayedExpansion
title PermaTrax Platform
color 0A

REM ── Resolve paths (no hardcoded drive letters) ──────────────────────────────
set "PT_ROOT=%~dp0"
if "%PT_ROOT:~-1%"=="\" set "PT_ROOT=%PT_ROOT:~0,-1%"
set "PT_SCRIPTS=%PT_ROOT%\scripts"
cd /d "%PT_ROOT%"

REM ── Mode detection ──────────────────────────────────────────────────────────
set USE_NGROK=0
if /I "%~1"=="--with-ngrok" set USE_NGROK=1
if /I "%~1"=="ngrok"        set USE_NGROK=1

echo.
echo  ================================================
echo    PermaTrax Fiber Construction Management
if "!USE_NGROK!"=="1" (
    echo    Mode: NGROK ^(tunnel publik^)
) else (
    echo    Mode: LOKAL ^(hanya localhost^)
    echo    Untuk ngrok: start.bat --with-ngrok
)
echo    Root: %PT_ROOT%
echo  ================================================
echo.

REM ── [pre] Idempotent cleanup ───────────────────────────────────────────────
echo  [pre] Membersihkan port 3000 / 3001 / 4040 dan ngrok.exe ^(jika ada^)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4040 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
taskkill /F /IM ngrok.exe /T >nul 2>&1
echo       OK

REM ── [0/6] Ensure uploads dir ───────────────────────────────────────────────
echo.
echo  [0/6] Menyiapkan direktori...
if not exist "%PT_ROOT%\apps\api\uploads" mkdir "%PT_ROOT%\apps\api\uploads"
echo       OK

REM ── [1/6] Docker (PostgreSQL + Redis) ──────────────────────────────────────
echo.
echo  [1/6] Menjalankan Docker ^(PostgreSQL + Redis^)...
docker-compose up -d
if %errorlevel% neq 0 (
    echo       ERROR: Docker gagal. Pastikan Docker Desktop berjalan.
    pause
    exit /b 1
)
echo       OK

REM ── [2/6] Prisma migrations ────────────────────────────────────────────────
echo.
echo  [2/6] Menerapkan migrasi database...
pushd "%PT_ROOT%\packages\db"
call npx prisma migrate deploy
set MIGRATE_EXIT=%errorlevel%
popd
if %MIGRATE_EXIT% neq 0 (
    echo       ERROR: Migrasi gagal ^(exit %MIGRATE_EXIT%^). Periksa pesan di atas.
    pause
    exit /b 1
)
echo       OK ^(migrate exit code=%MIGRATE_EXIT%^).

REM ── [3/6] Backend (NestJS dev) ─────────────────────────────────────────────
echo.
echo  [3/6] Menjalankan Backend API ^(port 3001^)...
start "PermaTrax API" cmd /k "cd /d %PT_ROOT%\apps\api && pnpm run start:dev"

echo       Menunggu backend siap ^(GET /api/health, max 60 dtk^)...
set HAVE_CURL=0
where curl.exe >nul 2>&1
if not errorlevel 1 set HAVE_CURL=1

set MAX_RETRIES=60
set RETRY_COUNT=0

:health_check_loop
timeout /t 1 /nobreak >nul
set HEALTH_CODE=
if "!HAVE_CURL!"=="1" (
    for /f "delims=" %%H in ('curl.exe -s -o nul -w "%%{http_code}" http://127.0.0.1:3001/api/health 2^>nul') do set HEALTH_CODE=%%H
) else (
    for /f "delims=" %%H in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { '' }"') do set HEALTH_CODE=%%H
)

if "!HEALTH_CODE!"=="200" (
    echo       Backend siap ^(health OK^).
    goto :backend_ready
)
set /a RETRY_COUNT+=1
if !RETRY_COUNT! geq !MAX_RETRIES! (
    echo       ERROR: Health check timeout setelah !MAX_RETRIES! dtk ^(kode terakhir: !HEALTH_CODE!^).
    echo       Periksa jendela "PermaTrax API" untuk error Nest/Prisma.
    pause
    exit /b 1
)
goto :health_check_loop

:backend_ready

REM ── [4/6] Frontend first when using ngrok (tunnel must hit a live Next server) ─
REM ── [4/6] Env only when local (LocalOnly before FE) ───────────────────────────
echo.
if "!USE_NGROK!"=="1" (
    echo  [4/6] Menjalankan Frontend ^(port 3000^) — wajib hidup sebelum ngrok...
    start "PermaTrax Web" cmd /k "cd /d %PT_ROOT%\apps\web && pnpm run dev"
    echo       Menunggu Next.js merespons di http://127.0.0.1:3000/ ...
    powershell -ExecutionPolicy Bypass -NoProfile -File "%PT_SCRIPTS%\wait-nextjs-ready.ps1"
    if !errorlevel! neq 0 (
        echo       ERROR: Next.js tidak siap. Periksa jendela "PermaTrax Web".
        pause
        exit /b 1
    )
    echo  [5/6] Menjalankan ngrok ^(tunnel ke :3000 saja^) via scripts\start-ngrok.ps1...
    powershell -ExecutionPolicy Bypass -NoProfile -File "%PT_SCRIPTS%\start-ngrok.ps1" -SkipBackendCheck
    set NGROK_EXIT=!errorlevel!
    if !NGROK_EXIT! neq 0 (
        echo       ERROR: start-ngrok.ps1 exit !NGROK_EXIT!.
        echo       Lihat output di atas. Jika ingin tetap lanjut dengan localhost,
        echo       jalankan: scripts\start-ngrok.ps1 -LocalOnly  lalu rerun start.bat.
        pause
        exit /b !NGROK_EXIT!
    )
    echo       OK
) else (
    echo  [4/6] Mode lokal — menulis env localhost via scripts\start-ngrok.ps1 -LocalOnly...
    powershell -ExecutionPolicy Bypass -NoProfile -File "%PT_SCRIPTS%\start-ngrok.ps1" -LocalOnly
    if !errorlevel! neq 0 (
        echo       PERINGATAN: gagal menulis env lokal. Lanjut tapi periksa apps\web\.env.local.
    ) else (
        echo       OK
    )
    echo  [5/6] Menjalankan Frontend ^(port 3000^)...
    start "PermaTrax Web" cmd /k "cd /d %PT_ROOT%\apps\web && pnpm run dev"
    timeout /t 3 /nobreak >nul
)

REM ── [6/6] Summary ──────────────────────────────────────────────────────────
echo.
echo  ================================================
echo    SIAP — PermaTrax
echo.
echo    Lokal:
echo      Frontend : http://localhost:3000
echo      Backend  : http://localhost:3001/api
echo      Health   : http://localhost:3001/api/health
if "!USE_NGROK!"=="1" (
    echo    Ngrok    : lihat output start-ngrok.ps1 di atas atau http://localhost:4040
)
echo    Files    : http://localhost:3001/api/files/
echo  ================================================
echo.
echo   Akun demo:
echo    GM          : gm@permatrax.com            GMPassword123!
echo    PM FTTH     : pm.ftth@permatrax.com       PMPassword123!
echo    PM Senior   : pm.senior@permatrax.com     PMSPassword123!
echo    Admin       : admin@permatrax.com         AdminPassword123!
echo    Surveyor    : surveyor.ftth@permatrax.com SurveyPassword123!
echo    Finance     : finance@permatrax.com       FinancePassword123!
echo    Ops Manager : ops.manager@permatrax.com   OpsManager123!
echo    Marketing   : marketing@permatrax.com     Marketing123!
echo  ================================================
echo.
pause
endlocal
exit /b 0
