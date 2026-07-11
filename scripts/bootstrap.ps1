<#
.SYNOPSIS
  One-command bootstrap for Cinekive (Docker engine).

.DESCRIPTION
  Creates data dirs, copies .env, pulls/builds images, starts the stack.
  Prefer this over raw `docker compose` if you just want the web UI.
#>
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "  Cinekive bootstrap"
Write-Host "  ------------------"

# Docker check
try {
  docker info 1>$null 2>$null
} catch {
  Write-Host ""
  Write-Host "  Docker Desktop is required for this install path."
  Write-Host "  1) Install: https://www.docker.com/products/docker-desktop/"
  Write-Host "  2) Start it until it says Running"
  Write-Host "  3) Re-run: .\scripts\bootstrap.ps1"
  Write-Host ""
  Write-Host "  Native (no Docker) engine is experimental — see docs/PACKAGING.md"
  exit 1
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "  Created .env from .env.example"
}

@(
  "data/videos",
  "data/artifacts",
  "data/qdrant",
  "data/db",
  "data/models",
  "data/library"
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

Write-Host "  Starting stack (first run may take several minutes)…"
docker compose up -d --build

Write-Host ""
Write-Host "  Open  http://localhost:3000"
Write-Host "  API   http://localhost:8000/docs"
Write-Host "  First search may download SigLIP (~800 MB) into ./data/models"
Write-Host ""
Write-Host "  Desktop app (optional): .\scripts\desktop.ps1"
Write-Host "  Or download installers: https://github.com/Gianluca-Improta/cinekive/releases"
Write-Host ""
