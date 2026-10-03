"""Numbered SQLite column adds.

create_all builds a fresh database from the models. Libraries created by older
builds are missing columns that were added later. This list is the history of
those adds. Bump SCHEMA_VERSION when you append a column, and add the column
to the SQLAlchemy model in the same change.

Startup applies any missing column and then records SCHEMA_VERSION. Re-running
is safe: existing columns are skipped.
"""

from __future__ import annotations

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

SCHEMA_VERSION = 3

# (table, column, sqlite type clause)
COLUMN_ADDS: tuple[tuple[str, str, str], ...] = (
    ("projects", "vlm_enrichment", "BOOLEAN DEFAULT 0"),
    ("projects", "watch_folder", "VARCHAR(1024)"),
    ("projects", "watch_enabled", "BOOLEAN DEFAULT 0"),
    ("projects", "brief", "TEXT"),
    ("projects", "feeling", "VARCHAR(512)"),
    ("projects", "references_text", "TEXT"),
    ("projects", "kind", "VARCHAR(32) DEFAULT 'commercial'"),
    ("projects", "form_factor", "VARCHAR(32)"),
    ("projects", "aspect_ratio", "VARCHAR(16)"),
    ("shots", "shot_type", "VARCHAR(64)"),
    ("shots", "camera_movement", "VARCHAR(64)"),
    ("shots", "lighting_style", "VARCHAR(64)"),
    ("shots", "mood_vibe", "VARCHAR(128)"),
    ("shots", "creative_intent", "TEXT"),
    ("shots", "tags_json", "JSON DEFAULT '[]'"),
    ("shots", "enrichment_version", "INTEGER DEFAULT 0"),
    ("shots", "notes", "TEXT"),
    ("shots", "is_favorite", "BOOLEAN DEFAULT 0"),
    ("shots", "content_format", "VARCHAR(64)"),
    ("shots", "emotion", "VARCHAR(64)"),
    ("shots", "sequence_id", "VARCHAR(36)"),
    ("shots", "frame_role", "VARCHAR(16)"),
    ("shots", "hero_score", "FLOAT DEFAULT 0"),
    ("shots", "is_hero", "BOOLEAN DEFAULT 0"),
    ("shots", "is_moving", "BOOLEAN DEFAULT 0"),
    ("shots", "grade_reason", "VARCHAR(255)"),
    ("shots", "phash", "VARCHAR(64)"),
    ("shots", "is_duplicate", "BOOLEAN DEFAULT 0"),
    ("shots", "duplicate_of", "VARCHAR(36)"),
    ("shots", "source_filename", "VARCHAR(512)"),
    ("shots", "source_title", "VARCHAR(512)"),
    ("shots", "source_meta_json", "JSON DEFAULT '{}'"),
    ("shots", "camera_angle", "VARCHAR(64)"),
    ("shots", "composition", "VARCHAR(128)"),
    ("shots", "subject", "VARCHAR(255)"),
    ("shots", "lens_look", "VARCHAR(64)"),
    ("shots", "color_grade", "VARCHAR(64)"),
    ("shots", "techniques_json", "JSON DEFAULT '[]'"),
    ("shots", "keyframe_ms", "INTEGER"),
    ("shots", "source_fps", "FLOAT"),
    ("shots", "collection_id", "VARCHAR(36)"),
    ("shots", "dialogue_json", "JSON"),
    ("shots", "dialogue_text", "TEXT"),
    ("shots", "era", "VARCHAR(64)"),
    ("shots", "origin", "VARCHAR(64)"),
    ("shots", "ism", "VARCHAR(64)"),
    ("shots", "visual_style", "VARCHAR(64)"),
    ("shots", "theme", "VARCHAR(64)"),
    ("shots", "genre", "VARCHAR(64)"),
    ("shots", "shapes_json", "JSON DEFAULT '[]'"),
    ("shots", "deleted_at", "DATETIME"),
    ("collections", "kind", "VARCHAR(32) DEFAULT 'moodboard'"),
    ("collections", "year", "INTEGER"),
    ("collections", "content_format", "VARCHAR(64)"),
    ("collections", "sampling_mode", "VARCHAR(16) DEFAULT 'moments'"),
    ("collections", "cover_shot_id", "VARCHAR(36)"),
    ("collections", "meta_json", "JSON DEFAULT '{}'"),
)


def pending_columns(existing: dict[str, set[str]]) -> list[tuple[str, str, str]]:
    """Columns in COLUMN_ADDS whose table exists and whose name is absent."""
    out: list[tuple[str, str, str]] = []
    for table, column, coltype in COLUMN_ADDS:
        have = existing.get(table)
        if have is None:
            continue
        if column not in have:
            out.append((table, column, coltype))
    return out


async def ensure_schema(conn) -> int:
    """Add missing columns and record SCHEMA_VERSION. Returns how many columns were added."""
    from sqlalchemy import inspect, text

    def _column_map(sync_conn) -> dict[str, set[str]]:
        insp = inspect(sync_conn)
        found: dict[str, set[str]] = {}
        for table in insp.get_table_names():
            found[table] = {col["name"] for col in insp.get_columns(table)}
        return found

    existing = await conn.run_sync(_column_map)
    added = 0
    for table, column, coltype in pending_columns(existing):
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))
        logger.info("Schema v%s added %s.%s", SCHEMA_VERSION, table, column)
        added += 1
    await conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS cinekive_schema ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)"
        )
    )
    await conn.execute(
        text(
            "INSERT INTO cinekive_schema (id, version) VALUES (1, :version) "
            "ON CONFLICT(id) DO UPDATE SET version = :version"
        ),
        {"version": SCHEMA_VERSION},
    )
    try:
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_shots_source_title ON shots (source_title)"))
    except Exception:
        logger.warning("Could not ensure ix_shots_source_title", exc_info=True)
    return added
