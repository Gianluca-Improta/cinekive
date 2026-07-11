# Live archive status dashboard (refreshes every 15s)
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
while ($true) {
    Clear-Host
    Write-Host ("Archive status — {0:HH:mm:ss}" -f (Get-Date))
    python scripts/archive_status.py
    Start-Sleep -Seconds 15
}
