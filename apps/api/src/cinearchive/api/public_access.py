"""Decide when a request arrived through a public share tunnel.

Loopback and LAN stay fully usable (the phone-on-WiFi feature). A Cloudflare
quick tunnel, or any host that is not a private address and carries a CF-Ray,
is browse-only.
"""

from __future__ import annotations


def _private_host(host: str) -> bool:
    h = host.replace("[", "").replace("]", "").split(":")[0].strip().lower()
    if h in {"", "localhost", "127.0.0.1", "::1"} or h.endswith(".local"):
        return True
    parts = h.split(".")
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return False
    a, b = int(parts[0]), int(parts[1])
    if a in {10, 127}:
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    return False


def is_public_tunnel(host: str, forwarded: str = "", cf_ray: str | None = None) -> bool:
    blob = f"{host} {forwarded}".lower()
    if "trycloudflare.com" in blob:
        return True
    primary = (forwarded or host).split(",")[0].strip()
    if cf_ray and not _private_host(primary):
        return True
    return False
