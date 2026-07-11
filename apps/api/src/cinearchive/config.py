"""Application settings from environment."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite+aiosqlite:////data/db/cinearchive.db"
    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "cinearchive_shots_v1"
    videos_dir: str = "/data/videos"
    artifacts_dir: str = "/data/artifacts"
    models_dir: str = "/data/models"
    # If set, overrides the default library root (videos_dir parent / "library")
    library_dir: str = ""

    embedding_model: str = "google/siglip-so400m-patch14-384"
    embedding_batch_size: int = 16
    embedding_dim: int = 1152
    device: Literal["auto", "cuda", "cpu"] = "auto"
    hf_home: str = "/data/models/huggingface"

    default_sampling_mode: Literal["fast", "full", "heroes", "moments"] = "heroes"
    scene_detect_threshold: float = 27.0
    generate_previews: bool = True
    preview_duration_sec: float = 2.5
    preview_format: Literal["webp", "mp4", "webm"] = "webp"

    # Curation — hero sequences
    max_heroes_per_video: int = 8
    motion_threshold: float = 0.035
    dedupe_hamming_threshold: int = 10
    sequence_dedupe_threshold: int = 8
    hide_duplicates_by_default: bool = True
    group_sequences_by_default: bool = True
    dedupe_on_ingest: bool = True
    dedupe_global: bool = True
    dedupe_interval_sec: float = 300.0
    preview_moving_min_sec: float = 2.5
    preview_static_sec: float = 1.6
    grade_use_audio: bool = True
    # moments = grade all scenes, mark top N as heroes (work archives)
    work_default_sampling: Literal["heroes", "moments", "full"] = "moments"

    # Dialogue / ASR (opt-in)
    asr_enabled: bool = False
    asr_model: str = "base"

    # Phase 1 — VLM enrichment (Ollama)
    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "qwen3-vl:8b"
    vlm_enabled: bool = False
    vlm_max_retries: int = 2
    vlm_timeout_sec: float = 120.0
    # auto | fast | balanced | quality — auto picks from VRAM (16GB → balanced)
    enrich_tier: Literal["auto", "fast", "balanced", "quality"] = "auto"
    # Override when API runs in Docker without nvidia-smi (e.g. 16 for 5060 Ti)
    enrich_vram_gb: float | None = None
    enrich_continuous: bool = True
    enrich_interval_sec: float = 90.0
    enrich_batch_size: int = 4
    enrich_quality_min: float = 55.0
    enrich_reenrich_fails: bool = True

    # Phase 2 — folder watcher
    watcher_enabled: bool = False
    watcher_poll_sec: float = 5.0

    # Inspiration Seek (opt-in external)
    seek_enabled: bool = False
    seek_download_dir: str = "/data/library/_seek"

    # Bootstrap mirrors (ShotDeck host capture)
    shotdeck_user: str = ""
    shotdeck_pass: str = ""
    mirror_scripts_dir: str = ""

    # Soft-delete bin — X on cards moves here; hard-delete after N days
    trash_retention_days: int = 30

    # Language / translation (English is the content core)
    libretranslate_url: str = ""  # e.g. http://libretranslate:5000 or https://libretranslate.com
    libretranslate_api_key: str = ""
    translate_allow_public_fallback: bool = True  # MyMemory when LibreTranslate unset
    translate_timeout_sec: float = 20.0

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000"
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
