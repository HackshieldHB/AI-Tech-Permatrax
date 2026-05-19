# =============================================================================
#  apply-ngrok-tunnels.ps1
#
#  Discovers active ngrok tunnels from the local ngrok agent (port 4040) and
#  writes their public URLs into:
#       apps/web/.env.local       -> NEXT_PUBLIC_API_URL, NEXT_PUBLIC_FILES_URL
#       apps/api/.env             -> FRONTEND_URL, FILE_BASE_URL
#
#  SINGLE-TUNNEL MODEL (default)
#  ---------------------------------------------------------------------------
#  Expect one ngrok tunnel to the Next.js port (3000). There must NOT be a
#  separate tunnel to the API port (3001). The browser uses same-origin
#  /api/*; Next.js rewrites to Nest on localhost:3001.
#
#  DESIGN NOTES
#  ---------------------------------------------------------------------------
#  - POLL, never sleep-and-pray. The previous version did one HTTP request
#    against localhost:4040 and silently fell back to localhost when ngrok
#    wasn't ready yet. We poll for up to $TimeoutSeconds.
#
#  - WRITE WITHOUT BOM. Windows PowerShell 5's `Set-Content -Encoding UTF8`
#    emits UTF-8 with BOM. dotenv treats the BOM as part of the FIRST var
#    name (e.g. <BOM>PORT=3001), so process.env.PORT becomes undefined.
#    We use [System.Text.UTF8Encoding]::new($false) for explicit no-BOM writes.
#
#  - FAIL LOUDLY. Exits non-zero if no tunnels are found. The orchestrator
#    (start.bat / start-ngrok.ps1) decides whether to fall back; this script
#    no longer hides the problem.
#
#  - REPO-RELATIVE. Resolves the repo root from $PSScriptRoot/.. so the file
#    can live anywhere.
#
#  PARAMETERS
#  ---------------------------------------------------------------------------
#    -TimeoutSeconds <int>     How long to poll localhost:4040 (default 40).
#    -FallbackLocalhost        If set, on timeout write localhost URLs instead
#                              of exiting non-zero. Off by default.
#    -BackendPort  <int>       Local API port for FallbackLocalhost only (default 3001).
#    -FrontendPort <int>       Upstream port for the FE tunnel   (default 3000).
# =============================================================================

[CmdletBinding()]
param(
    [int]    $TimeoutSeconds   = 40,
    [switch] $FallbackLocalhost,
    [int]    $BackendPort      = 3001,
    [int]    $FrontendPort     = 3000
)

$ErrorActionPreference = 'Stop'

# -- Disable system web proxy for THIS PowerShell session ---------------------
[System.Net.WebRequest]::DefaultWebProxy = $null

# -- Lean loopback GET (avoids PS5's IRM cold-start). See start-ngrok.ps1. ---
function Invoke-LoopbackJson {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [int] $TimeoutMs = 3000
    )
    $req = [System.Net.HttpWebRequest]::Create($Uri)
    $req.Proxy   = $null
    $req.Timeout = $TimeoutMs
    $req.Method  = 'GET'
    $resp   = $req.GetResponse()
    $stream = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $body   = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
    return ($body | ConvertFrom-Json)
}

# -- Path resolution (repo-relative) ------------------------------------------
$repoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiEnvPath   = Join-Path $repoRoot 'apps\api\.env'
$webEnvPath   = Join-Path $repoRoot 'apps\web\.env.local'

# -- Helper: write a file as UTF-8 WITHOUT BOM (PS5 + PS7 compatible) ---------
function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# -- Helper: idempotent KEY=VALUE upsert against an env file ------------------
function Set-EnvVar {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Key,
        # AllowEmptyString: deliberate -- we sometimes write KEY= (empty) so
        # the FE can fall back to a runtime-derived value (window.location).
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Value
    )

    $nl = [Environment]::NewLine
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
        $updated = $existing -replace $pattern, $line
    } else {
        if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) {
            $existing += $nl
        }
        $updated = $existing + $line + $nl
    }

    Write-Utf8NoBom -Path $Path -Content $updated
}

# -- Helper: pretty log -------------------------------------------------------
function Log {
    param([string] $Text, [string] $Color = 'Gray')
    Write-Host "      $Text" -ForegroundColor $Color
}

# -- Step 1: poll the ngrok agent until tunnels appear ------------------------
Write-Host ''
Write-Host '  apply-ngrok-tunnels: discovering tunnels...' -ForegroundColor Cyan

$tunnels   = $null
$deadline  = (Get-Date).AddSeconds($TimeoutSeconds)
$attempt   = 0

while ((Get-Date) -lt $deadline) {
    $attempt++
    try {
        $resp = Invoke-LoopbackJson -Uri 'http://localhost:4040/api/tunnels' -TimeoutMs 3000
        if ($resp -and $resp.tunnels -and $resp.tunnels.Count -gt 0) {
            $tunnels = $resp.tunnels
            break
        }
    } catch {
        # ngrok agent not up yet -- keep polling.
    }
    Start-Sleep -Milliseconds 500
}

if (-not $tunnels) {
    Log "ngrok agent did not expose any tunnels within $TimeoutSeconds s (attempts: $attempt)." 'Red'
    if ($FallbackLocalhost) {
        Log 'FallbackLocalhost set -- writing empty NEXT_PUBLIC_* (FE auto-detects from window.location).' 'Yellow'
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
        Set-EnvVar -Path $apiEnvPath -Key 'FRONTEND_URL'          -Value ("http://localhost:{0}"          -f $FrontendPort)
        Set-EnvVar -Path $apiEnvPath -Key 'FILE_BASE_URL'         -Value ("http://localhost:{0}/api/files" -f $BackendPort)
        exit 0
    }
    Log 'Refusing to silently fall back. Re-run start-ngrok.ps1 or pass -FallbackLocalhost.' 'Red'
    exit 2
}

# -- Step 2: find the FRONTEND tunnel (Next.js upstream port) -----------------
$frontendUrl = $null

foreach ($t in $tunnels) {
    $addr = [string]$t.config.addr
    if ($addr -match (':{0}$|^{0}$' -f $FrontendPort)) { $frontendUrl = $t.public_url }
}

if (-not $frontendUrl) {
    Log "No tunnel maps to frontend port $FrontendPort (Next.js)." 'Red'
    Log 'Discovered tunnels:' 'Gray'
    foreach ($t in $tunnels) {
        Log ("  - {0}  ->  {1}" -f $t.public_url, $t.config.addr) 'Gray'
    }
    Log 'Expected exactly one public URL to Next.js. Do not tunnel port 3001.' 'Yellow'
    if ($FallbackLocalhost) {
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
        Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
        exit 0
    }
    exit 3
}

$frontendUrl = $frontendUrl.TrimEnd('/')

# -- Step 3: write env files (BOM-free, idempotent) ---------------------------
#
# NEXT_PUBLIC_API_URL stays EMPTY: getApiUrl() in lib/auth.ts uses
#   - localhost dev  -> http://localhost:3001/api (direct to Nest in dev)
#   - ngrok / other  -> https://<host>/api (same-origin; Next rewrites to Nest)
#
# FILE_BASE_URL / FRONTEND_URL must be reachable from the browser; with a
# single ngrok URL that means file links go through the Next app: /api/files/*
$feOrigins = "http://localhost:$FrontendPort,$frontendUrl"
$filesUrl  = "$frontendUrl/api/files"

Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_API_URL'   -Value ''
Set-EnvVar -Path $webEnvPath -Key 'NEXT_PUBLIC_FILES_URL' -Value ''
Set-EnvVar -Path $apiEnvPath -Key 'FRONTEND_URL'          -Value $feOrigins
Set-EnvVar -Path $apiEnvPath -Key 'FILE_BASE_URL'         -Value $filesUrl

# -- Step 4: report -----------------------------------------------------------
Log "Public app URL : $frontendUrl"                                        'Green'
Log "Wrote NEXT_PUBLIC_API_URL   = (empty)   -- FE derives from window.location" 'Green'
Log "Wrote NEXT_PUBLIC_FILES_URL = (empty)   -- FE derives from window.location" 'Green'
Log "Wrote FRONTEND_URL          = $feOrigins"                               'Green'
Log "Wrote FILE_BASE_URL         = $filesUrl"                                'Green'
Log ("Effective browser API base : {0}/api (via Next.js when not on localhost)" -f $frontendUrl) 'Cyan'
Log 'Reminder: restart "next dev" ONCE so it picks up the empty env. After'  'Yellow'
Log 'that, future ngrok URL rotations do NOT require a frontend restart.'    'Yellow'

exit 0
