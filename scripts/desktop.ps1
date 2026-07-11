# Launch or build the Cinekive desktop app.
# Requires: Node.js, Docker Desktop (at runtime).
#
#   .\scripts\desktop.ps1           # start
#   .\scripts\desktop.ps1 -Dist     # Windows installer + portable
#   .\scripts\desktop.ps1 -Install  # force npm install

param(
  [switch]$Dist,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps\desktop"

if (-not (Test-Path (Join-Path $desktop "package.json"))) {
  Write-Error "apps/desktop not found"
}

# Ensure icon assets exist
$gen = Join-Path $desktop "scripts\generate-icon.ps1"
if (Test-Path $gen) {
  & $gen
}

Push-Location $desktop
try {
  if ($Install -or -not (Test-Path "node_modules")) {
    Write-Host "Installing desktop dependencies…"
    npm install
  }
  if ($Dist) {
    Write-Host "Building Windows installer + portable…"
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    npm run dist
    Write-Host ""
    Write-Host "Artifacts:"
    Get-ChildItem "release" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }
  } else {
    Write-Host "Starting Cinekive desktop…"
    npm start
  }
} finally {
  Pop-Location
}
