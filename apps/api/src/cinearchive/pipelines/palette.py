"""Palette / LAB color distance helpers."""

from __future__ import annotations

import math
from typing import Any


def hex_to_lab(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    def lin(c: float) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    lr, lg, lb = lin(r), lin(g), lin(b)
    x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375
    y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750
    z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041
    xn, yn, zn = 0.95047, 1.00000, 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


def palette_distance(
    palette_a: list[dict[str, Any]],
    palette_b: list[dict[str, Any]],
) -> float:
    """Weighted average nearest-neighbor LAB distance between two palettes."""
    if not palette_a or not palette_b:
        return 999.0

    def labs(p: list[dict[str, Any]]) -> list[tuple[tuple[float, float, float], float]]:
        out = []
        for c in p:
            lab = c.get("lab")
            if lab and len(lab) == 3:
                lab_t = (float(lab[0]), float(lab[1]), float(lab[2]))
            elif c.get("hex"):
                lab_t = hex_to_lab(c["hex"])
            else:
                continue
            pct = float(c.get("percentage") or 0) / 100.0
            out.append((lab_t, max(pct, 0.01)))
        return out

    a = labs(palette_a)
    b = labs(palette_b)
    if not a or not b:
        return 999.0

    total = 0.0
    weight = 0.0
    for lab_a, w in a:
        nearest = min(lab_distance(lab_a, lab_b) for lab_b, _ in b)
        total += nearest * w
        weight += w
    return total / max(weight, 1e-6)


def colors_from_hex_list(hexes: list[str]) -> list[dict[str, Any]]:
    n = max(len(hexes), 1)
    return [{"hex": h.upper() if h.startswith("#") else f"#{h.upper()}", "percentage": 100 / n, "lab": list(hex_to_lab(h if h.startswith("#") else f"#{h}"))} for h in hexes]
