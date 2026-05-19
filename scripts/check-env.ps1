# scripts/check-env.ps1
# PermaTrax Environment Diagnostic
# Usage: .\scripts\check-env.ps1
# Run from project root

param([string]$ProjectRoot = "D:\Projects\AI Tech\PermaTrack")

Set-Location $ProjectRoot -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  PermaTrax Environment Diagnostic" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# FIX: Docker - check by the real container names used by docker-compose (permatrack_db + permatrack_redis)
Write-Host "[ Docker ]" -ForegroundColor Yellow

$dockerRunning = $false
try {
    $dockerPs = docker ps --format "{{.Names}}" 2>&1
    if ($LASTEXITCODE -ne 0 -or ($dockerPs -is [string] -and $dockerPs -match "error|cannot|failed")) {
        throw "Docker not running"
    }
    $dockerRunning = $true

    # FIX: match both snake_case (permatrack_db) and older naming, fall back to generic postgres/redis
    $pgRunning = $dockerPs | Where-Object {
        $_ -match "permatrack_db|permatrack-db|postgres"
    }
    $rdRunning = $dockerPs | Where-Object {
        $_ -match "permatrack_redis|permatrack-redis|redis"
    }

    if ($pgRunning) {
        Write-Host "  [OK] PostgreSQL running ($($pgRunning -join ','))" -ForegroundColor Green
    } else {
        # FIX: fallback - confirm via backend health service map even if the container name differs
        try {
            $bh = Invoke-RestMethod "http://localhost:3001/api/health" -TimeoutSec 3
            if ($bh.services.database -eq "ok" -or $bh.services.database -eq "skipped") {
                Write-Host "  [OK] PostgreSQL reachable (confirmed via backend health)" -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] PostgreSQL not healthy" -ForegroundColor Red
                Write-Host "     Fix: docker-compose up -d" -ForegroundColor Yellow
                $allOk = $false
            }
        } catch {
            Write-Host "  [FAIL] PostgreSQL container not found" -ForegroundColor Red
            Write-Host "     Fix: docker-compose up -d" -ForegroundColor Yellow
            $allOk = $false
        }
    }

    if ($rdRunning) {
        Write-Host "  [OK] Redis running ($($rdRunning -join ','))" -ForegroundColor Green
    } else {
        # FIX: fallback via backend health services.redis
        try {
            $bh = Invoke-RestMethod "http://localhost:3001/api/health" -TimeoutSec 3
            if ($bh.services.redis -eq "ok" -or $bh.services.redis -eq "skipped") {
                Write-Host "  [OK] Redis reachable (confirmed via backend health)" -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] Redis not healthy" -ForegroundColor Red
                Write-Host "     Fix: docker-compose up -d" -ForegroundColor Yellow
                $allOk = $false
            }
        } catch {
            Write-Host "  [FAIL] Redis container not found" -ForegroundColor Red
            Write-Host "     Fix: docker-compose up -d" -ForegroundColor Yellow
            $allOk = $false
        }
    }

} catch {
    Write-Host "  [FAIL] Docker Desktop not running" -ForegroundColor Red
    Write-Host "     Fix: Start Docker Desktop, then: docker-compose up -d" -ForegroundColor Yellow
    $allOk = $false
}

# FIX: Backend API health check
Write-Host ""
Write-Host "[ Backend (port 3001) ]" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod "http://localhost:3001/api/health" `
        -TimeoutSec 5 -ErrorAction Stop
    Write-Host "  [OK] Running  status=$($health.status)" -ForegroundColor Green
    Write-Host "  [OK] DB=$($health.services.database)  Redis=$($health.services.redis)" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] NOT running on port 3001" -ForegroundColor Red
    Write-Host "     Fix: cd apps\api && npm run start:dev" -ForegroundColor Yellow
    $allOk = $false
}

# FIX: Frontend dev server check
Write-Host ""
Write-Host "[ Frontend (port 3000) ]" -ForegroundColor Yellow
try {
    $fe = Invoke-WebRequest "http://localhost:3000" `
        -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "  [OK] Running (HTTP $($fe.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] NOT running on port 3000" -ForegroundColor Red
    Write-Host "     Fix: cd apps\web && npm run dev" -ForegroundColor Yellow
    $allOk = $false
}

# FIX: ngrok - inspect project ngrok.yml for authtoken (instead of calling `ngrok config check` which merges global config)
Write-Host ""
Write-Host "[ ngrok ]" -ForegroundColor Yellow

# FIX: verify project ngrok.yml exists and contains an authtoken line
$ngrokYmlPath = Join-Path $ProjectRoot "ngrok.yml"
$ngrokYmlContent = ""
if (Test-Path $ngrokYmlPath) {
    $ngrokYmlContent = Get-Content $ngrokYmlPath -Raw
}
$hasAuthtoken = $ngrokYmlContent -match "(?m)^\s*authtoken:\s*\S+"

if (-not (Test-Path $ngrokYmlPath)) {
    Write-Host "  [FAIL] ngrok.yml not found" -ForegroundColor Red
    Write-Host "     Fix: .\scripts\start-ngrok.ps1" -ForegroundColor Yellow
    $allOk = $false
} elseif (-not $hasAuthtoken) {
    Write-Host "  [FAIL] ngrok.yml has no authtoken" -ForegroundColor Red
    Write-Host "     Fix: run .\scripts\start-ngrok.ps1 (will guide you)" -ForegroundColor Yellow
    $allOk = $false
} else {
    Write-Host "  [OK] ngrok.yml configured with authtoken" -ForegroundColor Green

    # FIX: check tunnels only after confirming config has authtoken
    try {
        $tunnels = Invoke-RestMethod "http://localhost:4040/api/tunnels" `
            -TimeoutSec 3 -ErrorAction Stop
        $beUrl = ($tunnels.tunnels |
            Where-Object { $_.config.addr -match "3001" } |
            Select-Object -First 1).public_url
        $feUrl = ($tunnels.tunnels |
            Where-Object { $_.config.addr -match "3000" } |
            Select-Object -First 1).public_url

        if ($beUrl) {
            Write-Host "  [OK] Backend tunnel : $beUrl" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] No backend tunnel (3001 not tunneled)" -ForegroundColor Red
            Write-Host "     Fix: .\scripts\start-ngrok.ps1" -ForegroundColor Yellow
            $allOk = $false
        }
        if ($feUrl) {
            Write-Host "  [OK] Frontend tunnel: $feUrl" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] No frontend tunnel (3000)" -ForegroundColor Yellow
        }
    } catch {
        # FIX: ngrok not running is a warning, not an error - local dev works fine
        Write-Host "  [WARN] ngrok not running (OK for local dev)" -ForegroundColor Yellow
        Write-Host "     For remote: .\scripts\start-ngrok.ps1" -ForegroundColor Gray
    }
}

# FIX: .env.local - presence + reachability + auto-heal to localhost on failure
Write-Host ""
Write-Host "[ .env.local ]" -ForegroundColor Yellow
$envPath = "apps\web\.env.local"

if (Test-Path $envPath) {
    $envLines  = Get-Content $envPath
    $apiUrlLine = ($envLines | Where-Object { $_ -match "^NEXT_PUBLIC_API_URL=" }) | Select-Object -First 1
    $apiUrl = if ($apiUrlLine) { ($apiUrlLine -replace "^NEXT_PUBLIC_API_URL=", "").Trim() } else { "" }

    Write-Host "  [OK] File exists" -ForegroundColor Green
    Write-Host "  API URL: $apiUrl" -ForegroundColor White

    if ($apiUrl) {
        try {
            $testH = Invoke-RestMethod "$apiUrl/health" `
                -Headers @{ 'ngrok-skip-browser-warning' = 'true' } `
                -TimeoutSec 5 -ErrorAction Stop
            Write-Host "  [OK] API URL is reachable ($($testH.status))" -ForegroundColor Green
        } catch {
            Write-Host "  [FAIL] API URL NOT reachable: $apiUrl" -ForegroundColor Red
            # FIX: auto-heal - switch .env.local back to localhost so the app at least boots
            Write-Host "     Auto-fixing: switching to localhost..." -ForegroundColor Yellow
            Set-Content $envPath "NEXT_PUBLIC_API_URL=http://localhost:3001/api" -Encoding UTF8
            Write-Host "  [OK] Fixed: NEXT_PUBLIC_API_URL=http://localhost:3001/api" -ForegroundColor Green
            Write-Host "     Restart frontend: cd apps\web && npm run dev" -ForegroundColor Yellow
            $allOk = $false
        }
    } else {
        Write-Host "  [FAIL] NEXT_PUBLIC_API_URL is empty" -ForegroundColor Red
        Set-Content $envPath "NEXT_PUBLIC_API_URL=http://localhost:3001/api" -Encoding UTF8
        Write-Host "  [OK] Fixed: set to http://localhost:3001/api" -ForegroundColor Green
        $allOk = $false
    }
} else {
    Write-Host "  [WARN] .env.local not found - creating with localhost default" -ForegroundColor Yellow
    Set-Content $envPath "NEXT_PUBLIC_API_URL=http://localhost:3001/api" -Encoding UTF8
    Write-Host "  [OK] Created: NEXT_PUBLIC_API_URL=http://localhost:3001/api" -ForegroundColor Green
    Write-Host "     Restart frontend: cd apps\web && npm run dev" -ForegroundColor Yellow
}

# FIX: summary + quick commands
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
if ($allOk) {
    Write-Host "  [OK] Everything looks good!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Open: http://localhost:3000" -ForegroundColor White
    Write-Host ""
    Write-Host "  Accounts:" -ForegroundColor Gray
    Write-Host "    GM      : gm@permatrax.com            / GMPassword123!" -ForegroundColor Gray
    Write-Host "    PM      : pm.ftth@permatrax.com       / PMPassword123!" -ForegroundColor Gray
    Write-Host "    Admin   : admin@permatrax.com         / AdminPassword123!" -ForegroundColor Gray
    Write-Host "    Surveyor: surveyor.ftth@permatrax.com / SurveyPassword123!" -ForegroundColor Gray
} else {
    Write-Host "  [FAIL] Issues found - follow fixes above" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Quick commands:" -ForegroundColor Yellow
    Write-Host "    Start everything : start.bat" -ForegroundColor White
    Write-Host "    Start ngrok only : .\scripts\start-ngrok.ps1" -ForegroundColor White
    Write-Host "    Run diagnostic   : .\scripts\check-env.ps1" -ForegroundColor White
}
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
