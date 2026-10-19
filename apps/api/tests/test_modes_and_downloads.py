"""Mode registry and download allowlist checks."""

from __future__ import annotations

import pytest

from cinearchive.modes.models import ModeId
from cinearchive.modes.packs import MODE_PACKS
from cinearchive.modes.registry import (
    all_modes_payload,
    get_pack,
    list_modes,
    mode_payload,
    sources_for_mode,
)
from cinearchive.pipelines.media_download import assert_download_allowed


def test_cinematic_is_the_default_pack():
    assert get_pack(None).id == ModeId.CINEMATIC
    assert get_pack("cinematic").id == ModeId.CINEMATIC


def test_unknown_mode_falls_back_to_cinematic():
    assert get_pack("not-a-mode").id == ModeId.CINEMATIC


def test_every_mode_has_its_own_vocabulary():
    nouns = {pack.reference_noun_plural for pack in MODE_PACKS.values()}
    assert len(nouns) == len(MODE_PACKS), "each mode needs a distinct noun"


def test_modes_are_listed_cinematic_first():
    ids = [pack.id.value for pack in list_modes()]
    assert ids[0] == "cinematic"
    assert set(ids) >= {"cinematic", "architecture", "fashion", "product"}


def test_design_modes_have_museum_sources():
    assert "loc" in sources_for_mode("architecture")
    assert "rijksmuseum" in sources_for_mode("product")
    assert "met" in sources_for_mode("fashion")


def test_mode_payload_shape():
    payload = mode_payload("architecture")
    assert payload["id"] == "architecture"
    assert payload["reference_noun_plural"] == "spaces"
    assert payload["search_placeholder"]
    assert isinstance(payload["sources"], list)


def test_all_modes_payload_lists_adapters():
    payload = all_modes_payload()
    assert "adapters" in payload
    assert "loc" in payload["adapters"]


class _Settings:
    download_allow_any_host = False
    download_allowed_hosts = "youtube.com,vimeo.com"


def test_download_rejects_private_addresses():
    with pytest.raises(RuntimeError, match="private or local"):
        assert_download_allowed("http://192.168.1.10/secret.mp4", _Settings())


def test_download_rejects_loopback():
    with pytest.raises(RuntimeError, match="private or local"):
        assert_download_allowed("http://127.0.0.1:8000/internal", _Settings())


def test_download_rejects_unknown_hosts():
    with pytest.raises(RuntimeError, match="not an allowed download source"):
        assert_download_allowed("https://evil.example.com/clip.mp4", _Settings())


def test_download_allows_listed_hosts():
    assert_download_allowed("https://www.youtube.com/watch?v=abc", _Settings())
    assert_download_allowed("https://vimeo.com/12345", _Settings())


def test_download_can_be_opened_up():
    class Open(_Settings):
        download_allow_any_host = True

    assert_download_allowed("https://any.example.com/clip.mp4", Open())
