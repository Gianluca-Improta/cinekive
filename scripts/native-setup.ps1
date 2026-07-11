<#
.SYNOPSIS
  Experimental: set up a Docker-free native engine under %APPDATA%\Cinekive\data\engine

.DESCRIPTION
  Downloads Qdrant, creates a Python venv with the API, builds Next.js standalone.
  Requires: Python 3.11+, Node 20+, ffmpeg on PATH, ~8 GB free disk.

  After this succeeds, set engineMode=native in Cinekive config (or use desktop
  once launcher wiring is complete). Until then, Docker remains the supported path.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Data = Join-Path $env:APPDATA "Cinekive\data"
$Engine = Join-Path $Data "engine"

Write-Host "Native engine setup (experimental)"
Write-Host "Target: $Engine"
Write-Host ""

foreach ($c in @("python","node","ffmpeg")) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
    Write-Host "Missing dependency: $c — install it and re-run."
    exit 1
  }
}

New-Item -ItemType Directory -Force -Path $Engine | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Data "qdrant"), (Join-Path $Data "db"), (Join-Path $Data "models"), (Join-Path $Data "artifacts"), (Join-Path $Data "videos"), (Join-Path $Data "library") | Out-Null

# --- Qdrant ---
$QDir = Join-Path $Engine "qdrant"
New-Item -ItemType Directory -Force -Path $QDir | Out-Null
$QExe = Join-Path $QDir "qdrant.exe"
if (-not (Test-Path $QExe)) {
  Write-Host "Downloading Qdrant…"
  $ver = "v1.13.2"
  $zip = Join-Path $env:TEMP "qdrant-windows-x86_64.zip"
  $url = "https://github.com/qdrant/qdrant/releases/download/$ver/qdrant-x86_64-pc-windows-msvc.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $QDir -Force
  if (-not (Test-Path $QExe)) {
    Get-ChildItem $QDir -Recurse -Filter qdrant.exe | Select-Object -First 1 | ForEach-Object {
      Copy-Item $_.FullName $QExe -Force
    }
  }
}

# --- Python venv + API ---
$Py = Join-Path $Engine "python"
if (-not (Test-Path (Join-Path $Py "Scripts\python.exe"))) {
  Write-Host "Creating Python venv (this installs torch — large download)…"
  python -m venv $Py
  & "$Py\Scripts\python.exe" -m pip install --upgrade pip
  & "$Py\Scripts\pip.exe" install -e (Join-Path $Root "apps\api")
}

# --- Next standalone ---
$WebOut = Join-Path $Engine "web"
Write-Host "Building Next.js standalone…"
Push-Location (Join-Path $Root "apps\web")
try {
  if (-not (Test-Path node_modules)) { npm install --legacy-peer-deps }
  $env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
  npm run build
  $standalone = Join-Path (Get-Location) ".next\standalone"
  if (-not (Test-Path $standalone)) { throw "standalone output missing — check next.config output:'standalone'" }
  if (Test-Path $WebOut) { Remove-Item $WebOut -Recurse -Force }
  Copy-Item $standalone $WebOut -Recurse
  $static = Join-Path (Get-Location) ".next\static"
  $destStatic = Join-Path $WebOut "apps\web\.next\static"
  if (-not (Test-Path (Split-Path $destStatic))) {
    # standalone layout varies; copy static next to server.js if present
    $server = Get-ChildItem $WebOut -Recurse -Filter server.js | Select-Object -First 1
    if ($server) {
      $staticDest = Join-Path $server.DirectoryName ".next\static"
      New-Item -ItemType Directory -Force -Path (Split-Path $staticDest) | Out-Null
      Copy-Item $static $staticDest -Recurse -Force
      # Flatten: ensure server.js at web root
      if ($server.DirectoryName -ne $WebOut) {
        Copy-Item $server.FullName (Join-Path $WebOut "server.js") -Force
      }
    }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $destStatic) | Out-Null
    Copy-Item $static $destStatic -Recurse -Force
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Native engine files are under: $Engine"
Write-Host "Start pieces manually to test:"
Write-Host "  1) $QExe"
Write-Host "  2) $Py\Scripts\python.exe -m uvicorn cinearchive.main:app --host 127.0.0.1 --port 8000"
Write-Host "  3) node $WebOut\server.js"
Write-Host ""
Write-Host "Docker remains the supported path until native is marked stable."
Write-Host "See docs/PACKAGING.md"
