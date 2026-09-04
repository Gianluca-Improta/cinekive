#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build Windows native engine pack for Cinekive desktop (CI + local).
  Output: dist/engine-win-x64.zip

  Uses python-build-standalone (relocatable) — NOT `python -m venv`, which
  hardcodes the CI runner path and breaks on user machines.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$OutRoot = Join-Path $Root "dist\engine-staging"
$Engine = Join-Path $OutRoot "engine"
$ZipOut = Join-Path $Root "dist\engine-win-x64.zip"

# Relocatable CPython (Astral python-build-standalone)
$PyTag = "20251202"
$PyVer = "3.11.14"
$PyUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$PyTag/cpython-$PyVer+$PyTag-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"

Write-Host "Building engine-win-x64 pack"
if (Test-Path $OutRoot) { Remove-Item $OutRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Engine | Out-Null

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $name"
  }
}

Require-Cmd node
Require-Cmd npm
# tar is available on modern Windows / GitHub Actions
Require-Cmd tar

# --- Qdrant ---
$QDir = Join-Path $Engine "qdrant"
New-Item -ItemType Directory -Force -Path $QDir | Out-Null
$QExe = Join-Path $QDir "qdrant.exe"
if (-not (Test-Path $QExe)) {
  Write-Host "Downloading Qdrant v1.13.2…"
  $ver = "v1.13.2"
  $zip = Join-Path $env:TEMP "qdrant-win.zip"
  Invoke-WebRequest -Uri "https://github.com/qdrant/qdrant/releases/download/$ver/qdrant-x86_64-pc-windows-msvc.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $QDir -Force
  Get-ChildItem $QDir -Recurse -Filter qdrant.exe | Select-Object -First 1 | ForEach-Object {
    if ($_.FullName -ne $QExe) { Copy-Item $_.FullName $QExe -Force }
  }
}

# --- Portable Node 20 ---
$NodeDir = Join-Path $Engine "node"
New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
$NodeZip = Join-Path $env:TEMP "node-win-x64.zip"
if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
  Write-Host "Downloading Node.js 20…"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip" -OutFile $NodeZip
  Expand-Archive -Path $NodeZip -DestinationPath $env:TEMP -Force
  Copy-Item (Join-Path $env:TEMP "node-v20.18.0-win-x64\node.exe") (Join-Path $NodeDir "node.exe") -Force
}

# --- ffmpeg (BtbN build) ---
$FfDir = Join-Path $Engine "ffmpeg\bin"
New-Item -ItemType Directory -Force -Path $FfDir | Out-Null
$FfExe = Join-Path $FfDir "ffmpeg.exe"
if (-not (Test-Path $FfExe)) {
  Write-Host "Downloading ffmpeg…"
  $ffZip = Join-Path $env:TEMP "ffmpeg-win.zip"
  Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $ffZip
  Expand-Archive -Path $ffZip -DestinationPath $env:TEMP -Force
  Get-ChildItem $env:TEMP -Recurse -Filter ffmpeg.exe | Select-Object -First 1 | ForEach-Object {
    Copy-Item $_.FullName $FfExe -Force
  }
}

# --- Relocatable Python (NOT a host venv) ---
$Py = Join-Path $Engine "python"
Write-Host "Downloading relocatable Python $PyVer…"
$pyTgz = Join-Path $env:TEMP "cpython-win-standalone.tar.gz"
$pyExtract = Join-Path $env:TEMP "cpython-win-extract"
if (Test-Path $pyExtract) { Remove-Item $pyExtract -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pyExtract | Out-Null
Invoke-WebRequest -Uri $PyUrl -OutFile $pyTgz
tar -xzf $pyTgz -C $pyExtract
# Archive contains a top-level `python/` folder
$pySrc = Join-Path $pyExtract "python"
if (-not (Test-Path (Join-Path $pySrc "python.exe"))) {
  $pySrc = Get-ChildItem $pyExtract -Directory | Select-Object -First 1 | ForEach-Object { $_.FullName }
}
if (Test-Path $Py) { Remove-Item $Py -Recurse -Force }
Copy-Item $pySrc $Py -Recurse -Force

$PyExe = Join-Path $Py "python.exe"
if (-not (Test-Path $PyExe)) { throw "python.exe missing after extract" }

# Smoke-check relocatable (must not reference hostedtoolcache)
& $PyExe -c "import sys; print(sys.executable); assert 'hostedtoolcache' not in sys.executable.lower()"

Write-Host "Installing API deps into relocatable Python (torch CPU)…"
& $PyExe -m ensurepip --upgrade
& $PyExe -m pip install --upgrade pip
& $PyExe -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
& $PyExe -m pip install (Join-Path $Root "apps\api")
& $PyExe -m pip install -U "yt-dlp>=2024.8.0" "curl_cffi>=0.7.0"

# Layout expected by engine-native.js: python/Scripts/python.exe on Windows
$Scripts = Join-Path $Py "Scripts"
New-Item -ItemType Directory -Force -Path $Scripts | Out-Null
if (-not (Test-Path (Join-Path $Scripts "python.exe"))) {
  # Standalone builds keep python.exe at root — shim Scripts\python.exe
  Copy-Item $PyExe (Join-Path $Scripts "python.exe") -Force
  if (Test-Path (Join-Path $Py "pythonw.exe")) {
    Copy-Item (Join-Path $Py "pythonw.exe") (Join-Path $Scripts "pythonw.exe") -Force
  }
}

# Final smoke: uvicorn importable
& (Join-Path $Scripts "python.exe") -c "import uvicorn, cinearchive; print('ok', cinearchive.__file__)"

# --- Next standalone ---
$WebOut = Join-Path $Engine "web"
Write-Host "Building Next.js standalone…"
Push-Location (Join-Path $Root "apps\web")
try {
  if (-not (Test-Path node_modules)) { npm install --legacy-peer-deps }
  $env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
  npm run build
  $standalone = Join-Path (Get-Location) ".next\standalone"
  if (-not (Test-Path $standalone)) { throw "standalone output missing" }
  Copy-Item $standalone $WebOut -Recurse
  $server = Get-ChildItem $WebOut -Recurse -Filter server.js | Select-Object -First 1
  if ($server -and $server.DirectoryName -ne $WebOut) {
    Copy-Item $server.FullName (Join-Path $WebOut "server.js") -Force
  }
  $staticSrc = Join-Path (Get-Location) ".next\static"
  $staticDest = Join-Path $WebOut ".next\static"
  New-Item -ItemType Directory -Force -Path (Split-Path $staticDest) | Out-Null
  Copy-Item $staticSrc $staticDest -Recurse -Force
} finally {
  Pop-Location
}

$Version = (Get-Content (Join-Path $Root "apps\desktop\package.json") | ConvertFrom-Json).version
Set-Content -Path (Join-Path $Engine "version.txt") -Value $Version -NoNewline

Write-Host "Creating zip: $ZipOut"
New-Item -ItemType Directory -Force -Path (Split-Path $ZipOut) | Out-Null
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path $Engine -DestinationPath $ZipOut -Force
Write-Host "Done: $ZipOut"
