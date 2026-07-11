# Background ingest keepalive — queues catch-up ingests every 20 min
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $val = $matches[2].Trim().Trim("'").Trim('"')
      [Environment]::SetEnvironmentVariable($name, $val, "Process")
    }
  }
}

$Log = Join-Path $Root "data\library\.cache\ingest_keepalive.log"
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
$pidFile = Join-Path $Root "data\library\.cache\ingest_keepalive.pid"

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($oldPid) {
    $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "Ingest keepalive already running (pid $oldPid)"
      exit 0
    }
  }
}

Write-Host "Starting ingest keepalive -> $Log"
$p = Start-Process -FilePath "python" `
  -ArgumentList "scripts/ingest_keepalive.py", "--interval-min", "20" `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Log `
  -RedirectStandardError (Join-Path (Split-Path $Log) "ingest_keepalive_stderr.log") `
  -WorkingDirectory $Root `
  -PassThru

$p.Id | Set-Content $pidFile
Write-Host "Keepalive pid $($p.Id)"
