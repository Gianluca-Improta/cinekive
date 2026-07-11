# Regenerates assets/icon.png and assets/icon.ico (no-op if Python/Pillow missing).
$ErrorActionPreference = "SilentlyContinue"
$here = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $here "assets"
if ((Test-Path (Join-Path $assets "icon.ico")) -and (Test-Path (Join-Path $assets "icon.png"))) {
  exit 0
}
Write-Host "Generating desktop icons…"
Push-Location (Split-Path -Parent (Split-Path -Parent $here))
python -c @"
from pathlib import Path
try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit(0)
out = Path(r'$assets')
out.mkdir(parents=True, exist_ok=True)
def make(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    m = max(2, size // 16)
    r = max(4, size // 8)
    inset = size // 8
    d.rounded_rectangle([inset, inset, size-inset-1, size-inset-1], radius=r, outline=(0, 229, 255, 255), width=m)
    cx = cy = size // 2
    rad = size // 5
    d.ellipse([cx-rad, cy-rad, cx+rad, cy+rad], outline=(0, 229, 255, 255), width=m+1)
    rad2 = size // 14
    d.ellipse([cx-rad2, cy-rad2, cx+rad2, cy+rad2], fill=(0, 229, 255, 255))
    return img
png = make(512)
png.save(out / 'icon.png')
sizes = [16, 32, 48, 64, 128, 256]
icons = [make(s) for s in sizes]
icons[0].save(out / 'icon.ico', format='ICO', sizes=[(s,s) for s in sizes], append_images=icons[1:])
"@
Pop-Location
