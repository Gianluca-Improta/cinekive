"""Export moodboards as zip / JSON / FrameChain / project gallery / PPTX."""

from __future__ import annotations

import html
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.project import Project
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.services.shot_mapper import shot_to_read
from cinearchive.utils.paths import ensure_dir


def _safe_name(text: str, fallback: str = "frame") -> str:
    clean = re.sub(r"[^\w.\- ]+", "", (text or "").strip()).strip().replace(" ", "-")
    return (clean[:72] or fallback)


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
                lines.append(
                    f"{i:03d}  {reel:8s} V     C        {src_in} {src_out} {rec_in} {rec_out}"
                )
                title = getattr(s, "source_title", None) or reel
                lines.append(f"* FROM CLIP NAME: {title}")
                if getattr(s, "dialogue_text", None):
                    lines.append(f"* DIALOGUE: {s.dialogue_text[:120]}")
                lines.append("")
            out.write_text("\n".join(lines), encoding="utf-8")
            return out

        out = export_dir / f"moodboard_{stamp}_{export_id}.zip"
        artifacts = Path(self.settings.artifacts_dir)
        from cinearchive.pipelines.realesrgan import upscale_image
        from cinearchive.services import library_config as lib_cfg

        _, _, export_scale = lib_cfg.resolve_for_archive(self.settings, None)
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            manifest = []
            for i, s in enumerate(shots):
                keyframe = artifacts / s.keyframe_path
                if keyframe.is_file():
                    arc = f"{i:03d}_{s.id[:8]}_keyframe.jpg"
                    export_src = keyframe
                    if export_scale > 1:
                        tmp = export_dir / f"_up_{s.id[:8]}.jpg"
                        export_src = upscale_image(
                            self.settings, keyframe, tmp, scale=export_scale
                        )
                    zf.write(export_src, arcname=arc)
                    if export_src != keyframe and export_src.is_file():
                        try:
                            export_src.unlink(missing_ok=True)
                        except OSError:
                            pass
                if include_previews and s.preview_path:
                    preview = artifacts / s.preview_path
                    if preview.is_file():
                        zf.write(preview, arcname=f"{i:03d}_{s.id[:8]}_preview{preview.suffix}")
                manifest.append(shot_to_read(s).model_dump(mode="json"))
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        return out

    async def export_project(
        self,
        project: Project,
        *,
        fmt: str = "gallery",
        include_previews: bool = False,
        max_shots: int = 800,
    ) -> Path:
        """Package a project for sharing: ZIP stills, browsable gallery, or PPTX deck."""
        shots, _ = await self.shots.list(project_id=project.id, limit=max_shots, offset=0)
        heroes = [s for s in shots if getattr(s, "is_hero", False)]
        use = heroes if len(heroes) >= 8 else shots
        if not use:
            raise ValueError("No shots in this project to export")

        export_dir = ensure_dir(Path(self.settings.artifacts_dir) / "_exports")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        export_id = uuid4().hex[:8]
        slug = _safe_name(project.slug or project.name, "project")
        artifacts = Path(self.settings.artifacts_dir)

        frames: list[tuple[object, Path, str]] = []
        for i, s in enumerate(use):
            keyframe = artifacts / s.keyframe_path
            if not keyframe.is_file():
                continue
            title = _safe_name(
                getattr(s, "source_title", None)
                or getattr(s, "source_filename", None)
                or s.id[:8],
                f"frame-{i + 1:03d}",
            )
            frames.append((s, keyframe, f"{i + 1:03d}_{title}.jpg"))

        if not frames:
            raise ValueError("No keyframe files found for export")

        if fmt == "pptx":
            out = export_dir / f"{slug}_{stamp}_{export_id}.pptx"
            _write_pptx(out, project.name, frames)
            return out

        out = export_dir / f"{slug}_{stamp}_{export_id}.zip"
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            project_meta = {
                "format": "cinekive-project-package-v1",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "project": {
                    "id": project.id,
                    "name": project.name,
                    "slug": project.slug,
                    "kind": project.kind,
                    "brief": project.brief,
                    "feeling": project.feeling,
                    "references_text": project.references_text,
                },
                "shot_count": len(frames),
            }
            zf.writestr("project.json", json.dumps(project_meta, indent=2))
            readme = (
                f"# {project.name}\n\n"
                f"Exported from Cinekive · {len(frames)} stills\n\n"
                f"Feeling: {project.feeling or '—'}\n\n"
                f"{project.brief or ''}\n\n"
                "Open index.html to flick through references, or browse stills/.\n"
            )
            zf.writestr("README.txt", readme)

            cards_html: list[str] = []
            manifest = []
            for s, path, arc_name in frames:
                zf.write(path, arcname=f"stills/{arc_name}")
                if include_previews and getattr(s, "preview_path", None):
                    preview = artifacts / s.preview_path
                    if preview.is_file():
                        zf.write(
                            preview,
                            arcname=f"previews/{Path(arc_name).stem}{preview.suffix}",
                        )
                label = html.escape(
                    str(
                        getattr(s, "source_title", None)
                        or getattr(s, "source_filename", None)
                        or Path(arc_name).stem
                    )
                )
                meta_bits = [
                    x
                    for x in [
                        getattr(s, "shot_type", None),
                        getattr(s, "mood_vibe", None),
                        (getattr(s, "techniques_json", None) or [None])[0],
                    ]
                    if x
                ]
                meta = html.escape(" · ".join(str(m) for m in meta_bits))
                cards_html.append(
                    f'<figure class="card"><img src="stills/{html.escape(arc_name)}" '
                    f'loading="lazy" alt="{label}"/><figcaption><strong>{label}</strong>'
                    f"<span>{meta}</span></figcaption></figure>"
                )
                manifest.append(shot_to_read(s).model_dump(mode="json"))

            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
            page = _gallery_html(project.name, project.feeling, "".join(cards_html))
            zf.writestr("index.html", page)

        return out


def _gallery_html(title: str, feeling: str | None, cards: str) -> str:
    t = html.escape(title or "Cinekive export")
    f = html.escape(feeling or "")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{t}</title>
<style>
  :root {{ color-scheme: dark; --bg:#0b0c0e; --panel:#14161a; --muted:#8b919a; --line:#2a2e35; --text:#f2f4f7; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); }}
  header {{ padding:1.25rem 1.5rem; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(11,12,14,.92); backdrop-filter:blur(8px); }}
  h1 {{ margin:0; font-size:1.15rem; letter-spacing:.02em; }}
  p {{ margin:.35rem 0 0; color:var(--muted); font-size:.85rem; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; padding:1.25rem; }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
  .card img {{ display:block; width:100%; aspect-ratio:3/2; object-fit:cover; background:#000; }}
  figcaption {{ padding:.65rem .75rem .8rem; }}
  figcaption strong {{ display:block; font-size:.8rem; font-weight:600; }}
  figcaption span {{ display:block; margin-top:.2rem; color:var(--muted); font-size:.7rem; }}
</style>
</head>
<body>
<header>
  <h1>{t}</h1>
  <p>{f or "Reference package from Cinekive — open stills/ or scroll the grid."}</p>
</header>
<main class="grid">
{cards}
</main>
</body>
</html>
"""


def _write_pptx(out: Path, title: str, frames: list[tuple[object, Path, str]]) -> None:
    """Minimal PPTX: one landscape slide per still (stdlib zipfile)."""
    sw, sh = 12192000, 6858000
    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="jpeg" ContentType="image/jpeg"/>',
        '<Default Extension="jpg" ContentType="image/jpeg"/>',
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    ]
    for i in range(1, len(frames) + 1):
        content_types.append(
            f'<Override PartName="/ppt/slides/slide{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
    content_types.append("</Types>")

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "\n".join(content_types))
        zf.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>
""",
        )
        slide_rels = []
        sld_ids = []
        for i, (_shot, path, arc_name) in enumerate(frames, start=1):
            media_name = f"image{i}.jpg"
            zf.write(path, arcname=f"ppt/media/{media_name}")
            zf.writestr(
                f"ppt/slides/_rels/slide{i}.xml.rels",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{media_name}"/>
</Relationships>
""",
            )
            zf.writestr(
                f"ppt/slides/slide{i}.xml",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="{html.escape(arc_name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{sw}" cy="{sh}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
""",
            )
            rid = i + 1
            slide_rels.append(
                f'<Relationship Id="rId{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
            )
            sld_ids.append(f'<p:sldId id="{255 + i}" r:id="rId{rid}"/>')

        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
"""
            + "\n".join(slide_rels)
            + "\n</Relationships>\n",
        )
        zf.writestr(
            "ppt/presentation.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    {"".join(sld_ids)}
  </p:sldIdLst>
  <p:sldSz cx="{sw}" cy="{sh}"/>
  <p:notesSz cx="{sw}" cy="{sh}"/>
</p:presentation>
""",
        )
        _ = title


def _ms_to_tc(ms: int, fps: float) -> str:
    total_frames = int(round((ms / 1000.0) * fps))
    ff = int(total_frames % max(1, int(round(fps))))
    total_sec = total_frames // max(1, int(round(fps)))
    ss = total_sec % 60
    mm = (total_sec // 60) % 60
    hh = total_sec // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"
