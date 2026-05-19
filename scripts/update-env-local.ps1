# Update NEXT_PUBLIC_API_URL in apps/web/.env.local — dipanggil dari start.bat (hindari escape { } bermasalah di CMD)
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $repoRoot 'apps\web\.env.local'
$newLine = "NEXT_PUBLIC_API_URL=$ApiUrl"

$lines = @()
if (Test-Path -LiteralPath $envFile) {
  $lines = @(Get-Content -LiteralPath $envFile)
}

$replaced = $false
$out = [System.Collections.Generic.List[string]]::new()
foreach ($line in $lines) {
  if ($line -match '^\s*NEXT_PUBLIC_API_URL=') {
    [void]$out.Add($newLine)
    $replaced = $true
  }
  else {
    [void]$out.Add($line)
  }
}
if (-not $replaced) {
  [void]$out.Add($newLine)
}

$out | Set-Content -LiteralPath $envFile -Encoding utf8
Write-Host "      .env.local: NEXT_PUBLIC_API_URL=$ApiUrl"
