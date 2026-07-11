"""Export moodboards as zip / JSON / FrameChain format."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.services.shot_mapper import shot_to_read
from cinearchive.utils.paths import ensure_dir


class ExportService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.shots = ShotRepository(session)

    async def export(
        self,
        shot_ids: list[UUID],
        *,
        fmt: str = "zip",
        include_previews: bool = False,
    ) -> Path:
        ids = [str(s) for s in shot_ids]
        shots = await self.shots.get_many(ids)
        if not shots:
            raise ValueError("No shots found for export")

        export_dir = ensure_dir(Path(self.settings.artifacts_dir) / "_exports")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        export_id = uuid4().hex[:8]

        if fmt == "json":
            out = export_dir / f"moodboard_{stamp}_{export_id}.json"
            payload = {
                "format": "cinearchive-moodboard-v1",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "shots": [shot_to_read(s).model_dump(mode="json") for s in shots],
            }
            out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            return out

        if fmt == "framechain":
            out = export_dir / f"framechain_refs_{stamp}_{export_id}.json"
            refs = []
            for s in shots:
                refs.append(
                    {
                        "id": s.id,
                        "project_id": s.project_id,
                        "collection_id": getattr(s, "collection_id", None),
                        "timecode_in_ms": s.start_timecode_ms,
                        "timecode_out_ms": s.end_timecode_ms,
                        "keyframe_ms": getattr(s, "keyframe_ms", None),
                        "source_fps": getattr(s, "source_fps", None),
                        "source_path": s.source_path,
                        "source_filename": getattr(s, "source_filename", None),
                        "keyframe": s.keyframe_path,
                        "thumb": s.thumb_md_path,
                        "tags": s.tags_json or [],
                        "techniques": getattr(s, "techniques_json", None) or [],
                        "shot_type": s.shot_type,
                        "mood": s.mood_vibe,
                        "dialogue_text": getattr(s, "dialogue_text", None),
                        "palette": s.dominant_colors_json or [],
                        "notes": s.notes,
                        "hero_score": float(getattr(s, "hero_score", 0) or 0),
                    }
                )
            out.write_text(
                json.dumps(
                    {
                        "format": "framechain-references-v1",
                        "exported_at": datetime.now(timezone.utc).isoformat(),
                        "references": refs,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            return out

        if fmt == "edl":
            # CMX3600-ish EDL for NLE import (relative seconds as HH:MM:SS:FF @ source fps)
            out = export_dir / f"cinearchive_{stamp}_{export_id}.edl"
            lines = ["TITLE: CineArchive Export", "FCM: NON-DROP FRAME", ""]
            for i, s in enumerate(shots, start=1):
                fps = float(getattr(s, "source_fps", None) or 24.0) or 24.0
                src_in = _ms_to_tc(s.start_timecode_ms or 0, fps)
                src_out = _ms_to_tc(s.end_timecode_ms or (s.start_timecode_ms or 0) + 1000, fps)
                rec_in = _ms_to_tc(0, fps)
                rec_out = _ms_to_tc(
                    max(40, (s.end_timecode_ms or 0) - (s.start_timecode_ms or 0)), fps
                )
                reel = (getattr(s, "source_filename", None) or Path(s.source_path).stem)[:8].upper()
                lines.append(f"{i:03d}  {reel:8s} V     C        {src_in} {src_out} {rec_in} {rec_out}")
                title = getattr(s, "source_title", None) or reel
                lines.append(f"* FROM CLIP NAME: {title}")
                if getattr(s, "dialogue_text", None):
                    lines.append(f"* DIALOGUE: {s.dialogue_text[:120]}")
                lines.append("")
            out.write_text("\n".join(lines), encoding="utf-8")
            return out

        # zip of images
        out = export_dir / f"moodboard_{stamp}_{export_id}.zip"
        artifacts = Path(self.settings.artifacts_dir)
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            manifest = []
            for i, s in enumerate(shots):
                keyframe = artifacts / s.keyframe_path
                if keyframe.is_file():
                    arc = f"{i:03d}_{s.id[:8]}_keyframe.jpg"
                    zf.write(keyframe, arcname=arc)
                if include_previews and s.preview_path:
                    preview = artifacts / s.preview_path
                    if preview.is_file():
                        zf.write(preview, arcname=f"{i:03d}_{s.id[:8]}_preview{preview.suffix}")
                manifest.append(shot_to_read(s).model_dump(mode="json"))
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        return out


def _ms_to_tc(ms: int, fps: float) -> str:
    total_frames = int(round((ms / 1000.0) * fps))
    ff = int(total_frames % max(1, int(round(fps))))
    total_sec = total_frames // max(1, int(round(fps)))
    ss = total_sec % 60
    mm = (total_sec // 60) % 60
    hh = total_sec // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"
