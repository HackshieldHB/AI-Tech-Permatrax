# Backup manual PermaTrack — jalankan sebelum deploy produksi atau migrasi schema berisiko.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# Override folder backup: $env:PERMATRACK_BACKUP_ROOT = "D:\backups"

$ErrorActionPreference = "Stop"
$BackupRoot = if ($env:PERMATRACK_BACKUP_ROOT) { $env:PERMATRACK_BACKUP_ROOT } else { "D:\backups" }
$RepoRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$backupDir = Join-Path $BackupRoot "PermaTrack_$timestamp"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Write-Host "Backup ke: $backupDir"

# 1) Arsip kode (tanpa node_modules / .next / dist / .git). Staging unik di %TEMP%; uploads di-backup terpisah.
$staging = Join-Path $env:TEMP ("PermaTrackStaging_" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
# uploads di-backup terpisah (baris 3); hindari path sangat panjang di arsip kode
robocopy $RepoRoot $staging /E /XD node_modules .next dist .git "apps\api\uploads" /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy gagal dengan kode $LASTEXITCODE" }
$zipPath = Join-Path $backupDir "project_partial.zip"
if (Get-Command tar -ErrorAction SilentlyContinue) {
    & tar.exe -a -cf $zipPath -C $staging .
} else {
    Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force
}
cmd /c "if exist `"$staging`" rmdir /s /q `"$staging`""

# 2) Database (butuh pg_dump di PATH)
$dbOut = Join-Path $backupDir "database.sql"
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
    $envFile = Join-Path $RepoRoot "packages\db\.env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*DATABASE_URL=(.+)$') { $dbUrl = $Matches[1].Trim('"') }
        }
    }
}
$pgDumpCmd = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $dbUrl) {
    Write-Warning "DATABASE_URL tidak ditemukan — lewati pg_dump."
} elseif (-not $pgDumpCmd) {
    Write-Warning "pg_dump tidak ada di PATH — lewati dump database."
} else {
    try {
        $exe = if ($pgDumpCmd.Path) { $pgDumpCmd.Path } else { $pgDumpCmd.Source }
        & $exe @('--dbname', $dbUrl, '-f', $dbOut)
        Write-Host "Database dump: $dbOut"
    } catch {
        Write-Warning "pg_dump gagal: $_"
    }
}

# 3) Uploads lokal API (tar hindari MAX_PATH pada file bernama sangat panjang)
$uploads = Join-Path $RepoRoot "apps\api\uploads"
if (Test-Path $uploads) {
    $upZip = Join-Path $backupDir "uploads.zip"
    try {
        if (Get-Command tar -ErrorAction SilentlyContinue) {
            if (Test-Path $upZip) { Remove-Item -Force $upZip }
            & tar.exe -a -cf $upZip -C $RepoRoot "apps/api/uploads"
        } else {
            Compress-Archive -Path $uploads -DestinationPath $upZip -Force
        }
        Write-Host "Uploads: $upZip"
    } catch {
        Write-Warning "Arsip uploads gagal (path panjang?): $_"
    }
}

Write-Host "Selesai. Isi folder:"
Get-ChildItem $backupDir | Format-Table Name, Length
