"""Initial schema migration."""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sampling_mode", sa.String(16), nullable=False),
        sa.Column("generate_previews", sa.Boolean(), nullable=False),
        sa.Column("video_dir", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_projects_slug", "projects", ["slug"], unique=True)

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("progress_pct", sa.Float(), nullable=False),
        sa.Column("current_step", sa.String(255), nullable=False),
        sa.Column("total_items", sa.Integer(), nullable=False),
        sa.Column("processed_items", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_jobs_project_id", "jobs", ["project_id"])
    op.create_index("ix_jobs_status", "jobs", ["status"])

    op.create_table(
        "shots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(16), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("scene_index", sa.Integer(), nullable=False),
        sa.Column("start_timecode_ms", sa.Integer(), nullable=True),
        sa.Column("end_timecode_ms", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("keyframe_path", sa.Text(), nullable=False),
        sa.Column("thumb_sm_path", sa.Text(), nullable=False),
        sa.Column("thumb_md_path", sa.Text(), nullable=False),
        sa.Column("preview_path", sa.Text(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("dominant_colors_json", sa.JSON(), nullable=False),
        sa.Column("has_preview", sa.Boolean(), nullable=False),
        sa.Column("qdrant_point_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_shots_project_id", "shots", ["project_id"])
    op.create_index("ix_shots_has_preview", "shots", ["has_preview"])

    op.create_table(
        "ingest_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_paths_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ingest_batches_project_id", "ingest_batches", ["project_id"])
    op.create_index("ix_ingest_batches_job_id", "ingest_batches", ["job_id"])


def downgrade() -> None:
    op.drop_table("ingest_batches")
    op.drop_table("shots")
    op.drop_table("jobs")
    op.drop_table("projects")
