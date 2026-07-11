"""Phase 1/2 schema additions."""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_phase12"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("vlm_enrichment", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("watch_folder", sa.String(1024), nullable=True))
        batch.add_column(sa.Column("watch_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("shots") as batch:
        batch.add_column(sa.Column("shot_type", sa.String(64), nullable=True))
        batch.add_column(sa.Column("camera_movement", sa.String(64), nullable=True))
        batch.add_column(sa.Column("lighting_style", sa.String(64), nullable=True))
        batch.add_column(sa.Column("mood_vibe", sa.String(128), nullable=True))
        batch.add_column(sa.Column("creative_intent", sa.Text(), nullable=True))
        batch.add_column(sa.Column("tags_json", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("enrichment_version", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("notes", sa.Text(), nullable=True))
        batch.add_column(sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.create_index("ix_shots_shot_type", ["shot_type"])
        batch.create_index("ix_shots_mood_vibe", ["mood_vibe"])
        batch.create_index("ix_shots_is_favorite", ["is_favorite"])

    op.create_table(
        "collections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_collections_project_id", "collections", ["project_id"])

    op.create_table(
        "collection_shots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("collection_id", sa.String(36), sa.ForeignKey("collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("collection_id", "shot_id", name="uq_collection_shot"),
    )
    op.create_index("ix_collection_shots_collection_id", "collection_shots", ["collection_id"])
    op.create_index("ix_collection_shots_shot_id", "collection_shots", ["shot_id"])


def downgrade() -> None:
    op.drop_table("collection_shots")
    op.drop_table("collections")
    with op.batch_alter_table("shots") as batch:
        for col in [
            "shot_type",
            "camera_movement",
            "lighting_style",
            "mood_vibe",
            "creative_intent",
            "tags_json",
            "enrichment_version",
            "notes",
            "is_favorite",
        ]:
            batch.drop_column(col)
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("vlm_enrichment")
        batch.drop_column("watch_folder")
        batch.drop_column("watch_enabled")
