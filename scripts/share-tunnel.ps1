# Share your local Cinekive UI temporarily via Cloudflare Tunnel.
# Requires: cloudflared  (winget install Cloudflare.cloudflared)
#
# Anyone with the printed URL can browse your library while this runs.
# Stop with Ctrl+C. Do not leave open on untrusted networks.

$ErrorActionPreference = "Stop"

$web = if ($env:CINEKIVE_WEB_URL) { $env:CINEKIVE_WEB_URL } else { "http://localhost:3000" }

Write-Host ""
Write-Host "  Cinekive view link"
Write-Host "  Tunneling $web"
Write-Host "  Install if needed:  winget install Cloudflare.cloudflared"
Write-Host "  Copy the https://….trycloudflare.com URL from the log below."
Write-Host "  Stop with Ctrl+C when guests are done."
Write-Host ""

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "cloudflared not found. Install with:"
  Write-Host "  winget install Cloudflare.cloudflared"
  exit 1
}

cloudflared tunnel --url $web
