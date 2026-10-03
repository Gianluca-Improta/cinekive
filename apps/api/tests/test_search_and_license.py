"""Regression checks that do not need Qdrant, PyTorch, or the network."""

import ast
from pathlib import Path

from cinearchive.services.lemonsqueezy_license import _normalize
from cinearchive.services.vec_score import calibrate_vec as _calibrate_vec

_REPO = Path(__file__).resolve().parents[1] / "src" / "cinearchive" / "repositories" / "vector_repo.py"


def test_calibrate_zero_is_zero():
    assert _calibrate_vec(0.0, 0.2) == 0.0
    assert _calibrate_vec(0.2, 0.0) == 0.0


def test_calibrate_strong_match_reaches_keyword_scale():
    # best == _VEC_STRONG (0.20) and this hit is the best → 1.0, so it can beat a keyword hit.
    assert _calibrate_vec(0.20, 0.20) == 1.0


def test_calibrate_weaker_hit_ranks_below_the_best():
    assert abs(_calibrate_vec(0.10, 0.20) - 0.5) < 1e-9


def test_vector_search_accepts_craft_filters():
    tree = ast.parse(_REPO.read_text(encoding="utf-8"))
    search = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "search"
    )
    names = [arg.arg for arg in search.args.kwonlyargs]
    assert "camera_angle" in names
    assert "lens_look" in names


def test_lemon_rejects_other_products():
    data = {
        "activated": True,
        "license_key": {"status": "active", "activation_usage": 1, "activation_limit": 3},
        "instance": {"id": "inst-1", "name": "desk"},
        "meta": {"product_id": 999, "product_name": "Other", "customer_email": "a@b.c"},
    }
    out = _normalize(data, activated=True)
    assert out["success"] is False
    assert "not for Cinekive" in (out["message"] or "")


def test_lemon_accepts_cinekive_product():
    data = {
        "activated": True,
        "license_key": {"status": "active", "activation_usage": 1, "activation_limit": 3},
        "instance": {"id": "inst-1", "name": "desk"},
        "meta": {"product_id": "1346696", "product_name": "CineKive Pro", "variant_name": "Lifetime"},
    }
    out = _normalize(data, activated=True)
    assert out["success"] is True
    assert out["instance_id"] == "inst-1"
    assert out["limit"] == 3


def test_pending_columns_skips_present_and_missing_tables():
    from cinearchive.db.schema_migrate import pending_columns

    existing = {"shots": {"shot_type"}, "projects": set()}
    pending = pending_columns(existing)
    tables = {row[0] for row in pending}
    assert "collections" not in tables
    assert ("shots", "shot_type", "VARCHAR(64)") not in [
        (t, c, ty) for t, c, ty in pending if c == "shot_type"
    ]
    assert any(c == "camera_angle" for _, c, _ in pending)


def test_public_tunnel_detects_cloudflare_only():
    from cinearchive.api.public_access import is_public_tunnel

    assert is_public_tunnel("abc.trycloudflare.com", "") is True
    assert is_public_tunnel("127.0.0.1:8000", "") is False
    assert is_public_tunnel("192.168.1.20:8000", "", "ray") is False
    assert is_public_tunnel("library.example.com", "", "ray") is True


def test_lemon_rejects_disabled():
    data = {
        "valid": False,
        "license_key": {"status": "disabled", "activation_usage": 1, "activation_limit": 3},
        "instance": {"id": "inst-1"},
        "meta": {"product_id": "1346696"},
    }
    out = _normalize(data, activated=False)
    assert out["success"] is False
    assert out["status"] == "disabled"
