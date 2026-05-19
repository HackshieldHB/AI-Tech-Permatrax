# Waits until Next.js answers on http://127.0.0.1:3000/ (any 2xx–399).
# Used by start.bat before starting ngrok so the public URL hits a ready dev server.
[CmdletBinding()]
param(
    [int] $Port = 3000,
    [int] $MaxSeconds = 120
)

$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$uri = "http://127.0.0.1:$Port/"

while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-Host "       Next.js OK ($($r.StatusCode))" -ForegroundColor Green
            exit 0
        }
    } catch {
        # still starting
    }
    Start-Sleep -Seconds 1
}

Write-Host '       ERROR: Next.js tidak merespons di :3000 dalam batas waktu.' -ForegroundColor Red
exit 1
