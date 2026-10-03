"""Map raw SigLIP cosines onto the 0–1 scale used by keyword scores.

Kept free of database and model imports so a regression test can run without
Qdrant or PyTorch.
"""

# A raw cosine at or above this is a confidently strong SigLIP match.
VEC_STRONG = 0.20


def calibrate_vec(raw: float, best: float) -> float:
    """Map a raw SigLIP cosine onto the 0–1 scale keyword scores already use.

    Raw cosines top out near 0.25, so comparing them directly against keyword
    scores (0.4–1.0) meant a perfect visual match always lost to an incidental
    filename substring hit. Rank within the query decides the shape; the
    absolute best score decides how much confidence the whole query earns.
    """
    if raw <= 0 or best <= 0:
        return 0.0
    confidence = min(1.0, best / VEC_STRONG)
    return min(1.0, (raw / best) * confidence)
