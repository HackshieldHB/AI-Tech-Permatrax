# =============================================================================
#  start-ngrok.ps1
#
#  Brings the ngrok agent up, waits until it advertises the expected tunnels,
#  then delegates env-file rewrites to apply-ngrok-tunnels.ps1 and smoke-tests
#  /api/health through the public Next.js URL (same-origin proxy to Nest).
#
#  DESIGN
#  ---------------------------------------------------------------------------
#  - REPO-RELATIVE PATHS. Resolved from $PSScriptRoot -- no hardcoded D:\.
#  - IDEMPOTENT. Always kills lingering ngrok.exe first; safe to rerun.
#  - POWERSHELL 5 SAFE. No `??`, no ternaries, no PS7-only operators.
#  - PURE ASCII. No box-drawing or other multi-byte characters in code, so
#    PS5 cannot misparse the file when there is no BOM.
#  - HARD FAIL by default. If ngrok or backend isn't ready, exit non-zero so
#    the orchestrator (start.bat) can surface the failure.
#  - The env writer is a SEPARATE script (apply-ngrok-tunnels.ps1) so the
#    same logic is reused by start.bat and by humans running this manually.
#
#  USAGE
#  ---------------------------------------------------------------------------
#      .\scripts\start-ngrok.ps1                # full flow, hard-fail
#      .\scripts\start-ngrok.ps1 -LocalOnly     # write localhost env, skip ngrok
#      .\scripts\start-ngrok.ps1 -SkipBackendCheck
#                                               # don't require backend to be up
#                                               # (useful from start.bat which
#                                               # health-checks itself)
#      .\scripts\start-ngrok.ps1 -FallbackLocalhost
#                                               # write localhost env on timeout
#                                               # instead of exiting non-zero
# =============================================================================
#
#  IMPORTANT — ngrok MUST point at the FRONTEND only (default port 3000)
#  ---------------------------------------------------------------------------
#  This script starts:   ngrok http 3000
#  There is NO tunnel to port 3001. The Nest API is private on localhost;
#  browsers reach it only through Next.js same-origin paths: /api/*
#  (see apps/web/next.config.js `rewrites`).
#
# =============================================================================

[CmdletBinding()]
param(
    [switch] $LocalOnly,
    [switch] $SkipBackendCheck,
    [switch] $FallbackLocalhost,
    [int]    $BackendPort        = 3001,
    [int]    $FrontendPort       = 3000,
    # First-connection registration with the ngrok cloud can be slow on
    # free-tier accounts: 60-90 s is common, especially when the agent
    # region is geographically far from the user. 120 s default gives
    # comfortable headroom. Override via `-TunnelTimeoutSec <N>`.
    [int]    $TunnelTimeoutSec   = 120,
    [int]    $BackendHealthTries = 10
)

$ErrorActionPreference = 'Stop'

# -- Disable system web proxy for THIS PowerShell session ---------------------
# Invoke-RestMethod / Invoke-WebRequest in PS5 honour the Windows system
# proxy by default. With a PAC proxy set, HTTP calls to http://localhost:4040
# can be routed through the proxy and silently time out. Clearing
# DefaultWebProxy forces direct loopback traffic.
[System.Net.WebRequest]::DefaultWebProxy = $null

# -- Lean loopback GET helper -------------------------------------------------
# Why not Invoke-RestMethod? In a fresh powershell.exe process the FIRST IRM
# call pays a ~2.3 s cold-start (proxy auto-detect + cert cache). Inside the
# tunnel-polling loop with a 2 s per-request timeout, that cold-start makes
# every iteration time out before it can even reach localhost:4040.
# A raw HttpWebRequest with Proxy=$null skips all of that and responds in
# tens of milliseconds.
function Invoke-LoopbackJson {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [int] $TimeoutMs = 3000
    )
    $req = [System.Net.HttpWebRequest]::Create($Uri)
    $req.Proxy   = $null
    $req.Timeout = $TimeoutMs
    $req.Method  = 'GET'
    try {
        $resp   = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body   = $reader.ReadToEnd()
        $reader.Close(); $resp.Close()
        return ($body | ConvertFrom-Json)
    } catch {
        throw
    }
}

# -- Path resolution (repo-relative) ------------------------------------------
$repoRoot       = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ngrokYml       = Join-Path $repoRoot 'ngrok.yml'
$applyScript    = Join-Path $PSScriptRoot 'apply-ngrok-tunnels.ps1'
$webEnvPath     = Join-Path $repoRoot 'apps\web\.env.local'
$apiEnvPath     = Join-Path $repoRoot 'apps\api\.env'

Set-Location -LiteralPath $repoRoot

# -- Pretty banner ------------------------------------------------------------
function Write-Banner {
    Write-Host ''
    Write-Host '================================================' -ForegroundColor Cyan
    Write-Host '  PermaTrax -- Ngrok Tunnel Manager'              -ForegroundColor Cyan
    Write-Host '================================================' -ForegroundColor Cyan
    Write-Host ''
}

# -- Helper: write a file as UTF-8 WITHOUT BOM --------------------------------
function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# -- Helper: idempotent KEY=VALUE writer --------------------------------------
function Set-EnvVar {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Key,
        # AllowEmptyString: we deliberately write KEY= (empty) for the
        # NEXT_PUBLIC_* keys so the FE auto-detects via window.location.
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Value
    )
    if (Test-Path -LiteralPath $Path) {
        $existing = [System.IO.File]::ReadAllText($Path)
    } else {
        $parent = Split-Path -LiteralPath $Path -Parent
        if (-not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
        $existing = ''
    }
    $pattern = '(?m)^[ \t]*' + [regex]::Escape($Key) + '=.*$'
    $line    = "$Key=$Value"
    if ([regex]::IsMatch($existing, $pattern)) {
        $existing = $existing -replace $pattern, $line
    } else {
        if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) {
            $existing += [Environment]::NewLine
        }
        $existing += $line + [Environment]::NewLine
    }
    Write-Utf8NoBom -Path $Path -Content $existing
}

Write-Banner

# -- LOCAL-ONLY SHORTCUT ------------------------------------------------------
if ($LocalOnly) {
    Write-Host '[MODE] Local only -- clearing FE env so it auto-detects via window.location.' -ForegroundColor Yellow
    # NEXT_PUBLIC_API_URL is INTENTIONALLY empty. lib/auth.ts uses `/api` in the
    # browser (Next.js rewrites to Nest on :3001). Server-side Route Handlers
    # still call Nest via http://127.0.0.1:3001 as configured in code.
    Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
    Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
    Set-EnvVar -Path $apiEnvPath -Key 'FRONTEND_URL'          -Value ("http://localhost:{0}"          -f $FrontendPort)
    Set-EnvVar -Path $apiEnvPath -Key 'FILE_BASE_URL'         -Value ("http://localhost:{0}/api/files" -f $BackendPort)
    Write-Host '  OK -- apps/web/.env.local cleared; FE will auto-detect.' -ForegroundColor Green
    Write-Host '  Reminder: restart "next dev" ONCE to pick up the change.' -ForegroundColor Yellow
    exit 0
}

# -- [1/6] ngrok binary present? ---------------------------------------------
Write-Host '[1/6] Checking ngrok binary...' -NoNewline
$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokCmd) {
    Write-Host ' MISSING' -ForegroundColor Red
    Write-Host '       Install via:    winget install Ngrok.Ngrok' -ForegroundColor Yellow
    Write-Host '       Or download:    https://ngrok.com/download'  -ForegroundColor Yellow
    exit 10
}
try {
    $ngrokVer = (& ngrok version) 2>&1 | Select-Object -First 1
} catch {
    $ngrokVer = 'unknown'
}
Write-Host " OK ($ngrokVer)" -ForegroundColor Green

# -- [2/6] authtoken reachable (repo ngrok.yml is optional reference only) ---
Write-Host '[2/6] Checking ngrok authtoken...' -NoNewline
$userYmlPath  = Join-Path $env:USERPROFILE 'AppData\Local\ngrok\ngrok.yml'
$userHasToken = $false
if (Test-Path -LiteralPath $userYmlPath) {
    $userHasToken = (Get-Content -LiteralPath $userYmlPath -Raw) -match '(?m)^\s*authtoken\s*:'
}
$repoHasToken = $false
if (Test-Path -LiteralPath $ngrokYml) {
    $repoHasToken = (Get-Content -LiteralPath $ngrokYml -Raw) -match '(?m)^\s*authtoken\s*:'
}
if (-not ($repoHasToken -or $userHasToken)) {
    Write-Host ' NO AUTHTOKEN' -ForegroundColor Red
    Write-Host '       Run once on this machine:' -ForegroundColor Yellow
    Write-Host '         ngrok config add-authtoken <YOUR_TOKEN>' -ForegroundColor White
    Write-Host '       Token: https://dashboard.ngrok.com/get-started/your-authtoken' -ForegroundColor Yellow
    exit 12
}
if (-not (Test-Path -LiteralPath $ngrokYml)) {
    Write-Host ' OK (optional ngrok.yml not in repo -- using ngrok http only)' -ForegroundColor Green
} else {
    Write-Host ' OK' -ForegroundColor Green
}

# -- [3/6] backend reachable on the upstream port? ---------------------------
if (-not $SkipBackendCheck) {
    Write-Host "[3/6] Probing backend at http://localhost:$BackendPort/api/health..." -NoNewline
    $backendOk = $false
    $resp = $null
    for ($i = 0; $i -lt $BackendHealthTries; $i++) {
        try {
            $resp = Invoke-LoopbackJson -Uri ("http://localhost:{0}/api/health" -f $BackendPort) -TimeoutMs 3000
            if ($resp.status) { $backendOk = $true; break }
        } catch { Start-Sleep -Milliseconds 800 }
    }
    if (-not $backendOk) {
        Write-Host ' NOT RUNNING' -ForegroundColor Red
        Write-Host '       Start the backend first, e.g.:' -ForegroundColor Yellow
        Write-Host '         pnpm --filter @permatrack/api start:dev' -ForegroundColor White
        Write-Host '       Or rerun this script with -SkipBackendCheck if backend is starting.' -ForegroundColor Yellow
        exit 13
    }
    Write-Host " OK ($($resp.status))" -ForegroundColor Green
} else {
    Write-Host '[3/6] Skipping backend probe (per -SkipBackendCheck).' -ForegroundColor Gray
}

# -- [4/6] kill any stale ngrok + start fresh --------------------------------
Write-Host '[4/6] Killing any stale ngrok processes...' -NoNewline
$stale = Get-Process -Name 'ngrok' -ErrorAction SilentlyContinue
if ($stale) {
    $stale | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host (' killed {0}' -f $stale.Count) -ForegroundColor Yellow
} else {
    Write-Host ' none' -ForegroundColor Green
}

Write-Host '       Starting ngrok (frontend only)...' -NoNewline
$ngrokLog = Join-Path $repoRoot 'ngrok-stderr.log'
Remove-Item -LiteralPath $ngrokLog -ErrorAction SilentlyContinue

# Single tunnel to Next.js. Authtoken is read from the default user ngrok.yml.
# Do NOT start a second tunnel to :3001 — API is proxied via /api (next.config.js).
$ngrokArgs = @(
    'http', [string]$FrontendPort,
    '--region', 'ap'
)

$ngrokProc = Start-Process -FilePath 'ngrok' `
    -ArgumentList $ngrokArgs `
    -WindowStyle Hidden `
    -RedirectStandardError $ngrokLog `
    -PassThru
Write-Host (' PID {0}' -f $ngrokProc.Id) -ForegroundColor Green

# -- [5/6] poll ngrok agent until tunnels appear -----------------------------
Write-Host "[5/6] Waiting for tunnels (up to $TunnelTimeoutSec s)..." -NoNewline
$ready    = $false
$deadline = (Get-Date).AddSeconds($TunnelTimeoutSec)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    Write-Host '.' -NoNewline
    try {
        $check = Invoke-LoopbackJson -Uri 'http://localhost:4040/api/tunnels' -TimeoutMs 3000
        if ($check.tunnels -and $check.tunnels.Count -gt 0) {
            $ready = $true; break
        }
    } catch { }
    if ($ngrokProc.HasExited) {
        Write-Host ' AGENT EXITED' -ForegroundColor Red
        if (Test-Path -LiteralPath $ngrokLog) {
            Write-Host '       --- ngrok stderr (first 20 lines) ---' -ForegroundColor Gray
            Get-Content -LiteralPath $ngrokLog -TotalCount 20 | ForEach-Object {
                Write-Host "       $_" -ForegroundColor Gray
            }
        }
        if ($FallbackLocalhost) {
            Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
            Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
            Write-Host '       FallbackLocalhost set -- cleared FE env (auto-detect).' -ForegroundColor Yellow
            exit 0
        }
        exit 14
    }
}
if (-not $ready) {
    Write-Host ' TIMEOUT' -ForegroundColor Red
    if (Test-Path -LiteralPath $ngrokLog) {
        Write-Host '       --- ngrok stderr (first 20 lines) ---' -ForegroundColor Gray
        Get-Content -LiteralPath $ngrokLog -TotalCount 20 | ForEach-Object {
            Write-Host "       $_" -ForegroundColor Gray
        }
    }
    if ($FallbackLocalhost) {
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
        Write-Host '       FallbackLocalhost set -- cleared FE env (auto-detect).' -ForegroundColor Yellow
        exit 0
    }
    exit 15
}
Write-Host ' Ready!' -ForegroundColor Green

# -- [6/6] delegate env writes to apply-ngrok-tunnels.ps1 --------------------
Write-Host '[6/6] Applying tunnel URLs to env files...'
$applyArgs = @(
    '-File', $applyScript,
    '-BackendPort',  $BackendPort,
    '-FrontendPort', $FrontendPort,
    '-TimeoutSeconds', 5
)
if ($FallbackLocalhost) { $applyArgs += '-FallbackLocalhost' }

& powershell.exe -ExecutionPolicy Bypass -NoProfile @applyArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host ('       apply-ngrok-tunnels.ps1 exited {0}' -f $LASTEXITCODE) -ForegroundColor Red
    exit 16
}

# -- Smoke test: same-origin /api/health through Next.js (tunnel -> :3000) ---
Write-Host ''
Write-Host '  Smoke-testing /api/health via public ngrok URL (Next proxy -> API)...' -NoNewline
$smokeBase = $null
try {
    $tCheck = Invoke-LoopbackJson -Uri 'http://localhost:4040/api/tunnels' -TimeoutMs 3000
    foreach ($t in $tCheck.tunnels) {
        $addr = [string]$t.config.addr
        if ($addr -match (':{0}$|^{0}$' -f $FrontendPort)) {
            $smokeBase = $t.public_url.TrimEnd('/')
            break
        }
    }
} catch { }

if (-not $smokeBase) {
    Write-Host ' SKIPPED (could not resolve frontend tunnel URL)' -ForegroundColor Yellow
} else {
    try {
        $health = Invoke-RestMethod -Uri ("$smokeBase/api/health") `
            -Headers @{ 'ngrok-skip-browser-warning' = 'true' } `
            -TimeoutSec 15 -ErrorAction Stop
        Write-Host " OK ($($health.status))" -ForegroundColor Green
    } catch {
        Write-Host ' WARN (proxy check failed)' -ForegroundColor Yellow
        Write-Host "       $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host '       If Next.js is not running on :3000 yet (e.g. start.bat starts FE after ngrok),' -ForegroundColor Yellow
        Write-Host "       open manually after FE is up: $smokeBase/api/health" -ForegroundColor Yellow
        Write-Host '       Misconfig: ngrok pointing to :3001 shows JSON at site root, not the login page.' -ForegroundColor Yellow
    }
}

# -- Final report ------------------------------------------------------------
Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host '  Tunnel active (frontend -> Next.js)'              -ForegroundColor Green
Write-Host '================================================' -ForegroundColor Cyan
if ($smokeBase) {
    Write-Host "  Public app : $smokeBase"                         -ForegroundColor White
    Write-Host "  Health     : $smokeBase/api/health   (via Next.js rewrite)" -ForegroundColor White
    Write-Host "  Files      : $smokeBase/api/files    (via Next.js rewrite)" -ForegroundColor White
} else {
    Write-Host '  Public URL : (see http://localhost:4040/api/tunnels)' -ForegroundColor White
}
Write-Host "  Inspector  : http://localhost:4040"             -ForegroundColor White
Write-Host ''
Write-Host '  IMPORTANT: if "next dev" was already running before this script ran,' -ForegroundColor Yellow
Write-Host '  restart it -- Next.js only reads .env.local at startup.'              -ForegroundColor Yellow
Write-Host ''

exit 0
