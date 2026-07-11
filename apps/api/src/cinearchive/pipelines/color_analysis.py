"""Dominant color analysis via KMeans."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def _rgb_to_lab(rgb: np.ndarray) -> tuple[float, float, float]:
    """Approximate sRGB → LAB for a single pixel (0-255)."""
    r, g, b = [x / 255.0 for x in rgb]
    # sRGB to linear
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    # D65 reference white
    xn, yn, zn = 0.95047, 1.00000, 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    bb = 200 * (fy - fz)
    return (round(L, 2), round(a, 2), round(bb, 2))


def analyze_colors(image_path: Path, n_colors: int = 5) -> list[dict[str, Any]]:
    """Return dominant colors with hex, percentage, and LAB."""
    try:
        from sklearn.cluster import MiniBatchKMeans
    except ImportError:
        logger.warning("sklearn not available; skipping color analysis")
        return []

    try:
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            img.thumbnail((200, 200), Image.Resampling.LANCZOS)
            pixels = np.asarray(img, dtype=np.float32).reshape(-1, 3)
    except Exception as exc:
        logger.warning("Color analysis open failed: %s", exc)
        return []

    if len(pixels) < n_colors:
        n_colors = max(1, len(pixels))

    kmeans = MiniBatchKMeans(n_clusters=n_colors, random_state=42, n_init=3, batch_size=1024)
    labels = kmeans.fit_predict(pixels)
    centers = kmeans.cluster_centers_

    counts = np.bincount(labels, minlength=n_colors).astype(float)
    total = counts.sum() or 1.0
    order = np.argsort(-counts)

    results: list[dict[str, Any]] = []
    for idx in order:
        rgb = np.clip(centers[idx], 0, 255).astype(int)
        hex_color = f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
        pct = round(float(counts[idx] / total * 100), 1)
        results.append(
            {
                "hex": hex_color,
                "percentage": pct,
                "lab": list(_rgb_to_lab(rgb)),
            }
        )
    return results
