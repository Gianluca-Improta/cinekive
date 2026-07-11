#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build Windows native engine pack for Cinekive desktop (CI + local).
  Output: dist/engine-win-x64.zip
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$OutRoot = Join-Path $Root "dist\engine-staging"
$Engine = Join-Path $OutRoot "engine"
$ZipOut = Join-Path $Root "dist\engine-win-x64.zip"

Write-Host "Building engine-win-x64 pack"
if (Test-Path $OutRoot) { Remove-Item $OutRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Engine | Out-Null

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $name"
  }
}

Require-Cmd python
Require-Cmd node
Require-Cmd npm

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

# --- Python venv + API ---
$Py = Join-Path $Engine "python"
Write-Host "Creating Python venv (torch CPU — large)…"
python -m venv $Py
& "$Py\Scripts\python.exe" -m pip install --upgrade pip
& "$Py\Scripts\pip.exe" install --index-url https://download.pytorch.org/whl/cpu torch torchvision
& "$Py\Scripts\pip.exe" install -e (Join-Path $Root "apps\api")
& "$Py\Scripts\pip.exe" install -U "yt-dlp>=2024.8.0" "curl_cffi>=0.7.0"

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
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path $Engine -DestinationPath $ZipOut -Force
Write-Host "Done: $ZipOut"
