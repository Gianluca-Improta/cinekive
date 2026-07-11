$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example"
}

@(
  "data/videos",
  "data/artifacts",
  "data/qdrant",
  "data/db",
  "data/models",
  "data/library"
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

Write-Host "Starting Cinekive…"
docker compose up -d --build

Write-Host ""
Write-Host "  Web  http://localhost:3000"
Write-Host "  API  http://localhost:8000/docs"
Write-Host "  First run may download SigLIP (~800MB) into ./data/models"
Write-Host ""
