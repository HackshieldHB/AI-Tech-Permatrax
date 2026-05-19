# PermaTrax — Quick Start Guide

## Normal Development (Local Only)

```powershell
start.bat
```

Opens: <http://localhost:3000>

## With ngrok (share with team / test on mobile)

```powershell
start.bat
# Wait for everything to start, then (if the backend tunnel didn't come up in time):
.\scripts\start-ngrok.ps1
# The script writes the new URL into apps\web\.env.local and tells you to restart the frontend.
```

`start.bat` already tries to start ngrok and update `.env.local` automatically at step 4/5.
If it fails (no ngrok token, first run, offline, etc.) it falls back to `http://localhost:3001/api`.

## Diagnostic (Something not working?)

```powershell
.\scripts\check-env.ps1
```

Checks Docker / backend / frontend / ngrok / `.env.local` and prints a numbered fix for each problem it finds.

## ngrok URL changed — update manually

```powershell
.\scripts\start-ngrok.ps1
# Then restart the frontend so Next picks up the new env var:
cd apps\web
npm run dev
```

The frontend only reads `NEXT_PUBLIC_API_URL` once at build/dev boot, so you must restart `npm run dev` after `.env.local` changes.

## Accounts

| Role        | Email                         | Password          |
| ----------- | ----------------------------- | ----------------- |
| GM          | gm@permatrax.com              | GMPassword123!    |
| PM FTTH     | pm.ftth@permatrax.com         | PMPassword123!    |
| PM Senior   | pm.senior@permatrax.com       | PMSPassword123!   |
| Admin       | admin@permatrax.com           | AdminPassword123! |
| Surveyor    | surveyor.ftth@permatrax.com   | SurveyPassword123!|
| Finance     | finance@permatrax.com         | FinancePassword123! |
| Ops Manager | ops.manager@permatrax.com     | OpsManager123!    |
| Marketing   | marketing@permatrax.com       | Marketing123!     |

## Scripts reference

| Script                          | What it does                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `start.bat`                     | Docker + DB migrate + API + ngrok (auto-updates `.env.local`) + frontend.    |
| `scripts\start-ngrok.ps1`       | Restart ngrok with both tunnels, auto-update `.env.local` + `apps\api\.env`. |
| `scripts\start-ngrok.ps1 -LocalOnly` | Flip `.env.local` back to `http://localhost:3001/api` (no ngrok).      |
| `scripts\start-ngrok.sh`        | macOS / Linux equivalent of `start-ngrok.ps1`.                               |
| `scripts\check-env.ps1`         | Diagnose Docker / backend / frontend / ngrok / `.env.local` in one shot.     |

## Troubleshooting: "Backend tidak terjangkau" red banner

The dashboard polls `/health` every 20s. If the banner appears:

1. Is the API running? `cd apps\api && npm run start:dev`
2. Is `.env.local` pointing somewhere reachable? Run `.\scripts\check-env.ps1`.
3. Did ngrok restart? URLs change every time → re-run `.\scripts\start-ngrok.ps1` and restart frontend.
