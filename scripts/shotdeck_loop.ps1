# Start ShotDeck trial loop in background (Windows)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# Load .env into process env
if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $val = $matches[2].Trim().Trim("'").Trim('"')
      [Environment]::SetEnvironmentVariable($name, $val, "Process")
    }
  }
}

$OutDir = if ($env:SHOTDECK_LIBRARY_HOST) { $env:SHOTDECK_LIBRARY_HOST } else { "D:\library\_shotdeck" }
$Log = Join-Path $OutDir ".cache\loop_stdout.log"
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null

$pidFile = Join-Path $OutDir ".cache\loop.pid"
if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Host "ShotDeck loop already running (pid $oldPid)"
    exit 0
  }
}

Write-Host "Starting ShotDeck loop -> $Log"
Start-Process -FilePath "python" `
  -ArgumentList "scripts/shotdeck_loop.py", "--out", $OutDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Log `
  -RedirectStandardError (Join-Path $OutDir ".cache\loop_stderr.log") `
  -WorkingDirectory $Root

Start-Sleep -Seconds 2
if (Test-Path $pidFile) {
  Write-Host "Loop pid $(Get-Content $pidFile)"
} else {
  Write-Host "Loop starting - check $Log"
}
