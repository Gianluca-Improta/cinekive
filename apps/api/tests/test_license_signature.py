"""License signing rules — a Pro document must carry this install's signature."""

from __future__ import annotations

import hashlib
import hmac
import importlib
import json

import pytest

from cinearchive.services import entitlements as ent

PER_INSTALL_SECRET = "per-install-secret-for-tests"


@pytest.fixture(autouse=True)
def _isolated_license(tmp_path, monkeypatch):
    """Point the license lookup at a temp dir and sign with a per-install secret."""
    license_path = tmp_path / "license.json"
    monkeypatch.setenv("CINEKIVE_LICENSE_PATH", str(license_path))
    monkeypatch.setenv("CINEKIVE_USER_DATA", str(tmp_path / "userdata"))
    monkeypatch.setenv("CINEKIVE_LICENSE_SECRET", PER_INSTALL_SECRET)
    monkeypatch.delenv("CINEKIVE_TIER", raising=False)
    monkeypatch.delenv("CINEKIVE_ALLOW_DEV_LICENSE", raising=False)
    # The secret is read at import time, so reload the module with it applied.
    importlib.reload(ent)
    yield license_path
    monkeypatch.delenv("CINEKIVE_LICENSE_SECRET", raising=False)
    importlib.reload(ent)


def test_unsigned_pro_document_is_rejected(_isolated_license):
    _isolated_license.write_text(
        json.dumps({"tier": "pro", "source": "gumroad", "verifiedAt": 9999999999}),
        encoding="utf-8",
    )
    tier, meta = ent.resolve_tier()
    assert tier == "free"
    assert meta.get("error") == "bad_signature"


def test_signed_pro_document_is_accepted(_isolated_license):
    ent.write_license({"tier": "pro", "source": "gumroad", "verifiedAt": 9999999999})
    tier, _ = ent.resolve_tier()
    assert tier == "pro"


def test_tampered_pro_document_is_rejected(_isolated_license):
    ent.write_license({"tier": "pro", "source": "gumroad", "verifiedAt": 9999999999})
    doc = json.loads(_isolated_license.read_text(encoding="utf-8"))
    doc["verifiedAt"] = 1
    _isolated_license.write_text(json.dumps(doc), encoding="utf-8")
    tier, meta = ent.resolve_tier()
    assert tier == "free"
    assert meta.get("error") == "bad_signature"


def test_legacy_signature_is_migrated(_isolated_license):
    """A license signed by the pre-0.6 shared secret keeps working after upgrade."""
    legacy_secret = b"cinekive-pro-v1-open-core-not-a-vault"
    payload = {"tier": "pro", "source": "gumroad", "verifiedAt": 9999999999}
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

    doc = dict(payload)
    doc["signature"] = hmac.new(legacy_secret, body, hashlib.sha256).hexdigest()
    _isolated_license.write_text(json.dumps(doc), encoding="utf-8")

    # It does not verify against the current secret...
    assert ent.verify_signature(doc) is False
    # ...but the startup migration re-signs it, so Pro survives the upgrade.
    assert ent.migrate_license_signature() is True
    assert ent.verify_signature(json.loads(_isolated_license.read_text(encoding="utf-8")))
    tier, _ = ent.resolve_tier()
    assert tier == "pro"


def test_migration_leaves_valid_licenses_alone(_isolated_license):
    ent.write_license({"tier": "pro", "source": "gumroad", "verifiedAt": 9999999999})
    before = _isolated_license.read_text(encoding="utf-8")
    assert ent.migrate_license_signature() is False
    assert _isolated_license.read_text(encoding="utf-8") == before


def test_free_tier_needs_no_signature(_isolated_license):
    _isolated_license.write_text(json.dumps({"tier": "free"}), encoding="utf-8")
    tier, _ = ent.resolve_tier()
    assert tier == "free"


def test_env_pro_path_still_requires_the_dev_flag(monkeypatch):
    monkeypatch.setenv("CINEKIVE_TIER", "pro")
    tier, _ = ent.resolve_tier()
    assert tier == "free"

    monkeypatch.setenv("CINEKIVE_ALLOW_DEV_LICENSE", "true")
    tier, _ = ent.resolve_tier()
    assert tier == "pro"
