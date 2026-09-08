"""Board-only document rasterize + portable board bundles (no Shot ingest)."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings
from cinearchive.config import Settings
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.utils.paths import library_root

router = APIRouter(tags=["board"])


def _board_assets_dir(settings: Settings, project_id: str, board_id: str) -> Path:
    root = library_root(settings) / "_board_assets" / project_id / board_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def _rasterize_pdf(data: bytes, out_dir: Path, *, max_pages: int = 40) -> list[dict]:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError(
            "PDF import needs pypdfium2. Run: pip install pypdfium2"
        ) from exc

    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(data)
    pages: list[dict] = []
    n = min(len(pdf), max_pages)
    for i in range(n):
        page = pdf[i]
        # ~144 DPI-ish scale for board tiles
        bitmap = page.render(scale=2)
        pil = bitmap.to_pil()
        name = f"page-{i + 1:03d}.jpg"
        dest = out_dir / name
        pil.convert("RGB").save(dest, format="JPEG", quality=88)
        pages.append(
            {
                "page": i + 1,
                "filename": name,
                "path": str(dest),
                "width": pil.width,
                "height": pil.height,
            }
        )
    return pages


class ImportDocumentResponse(BaseModel):
    board_id: str
    pages: list[dict]
    message: str


@router.post(
    "/projects/{project_id}/boards/{board_id}/import-document",
    response_model=ImportDocumentResponse,
)
async def import_document(
    project_id: str,
    board_id: str,
    file: UploadFile = File(...),
    max_pages: int = Form(default=40),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
) -> ImportDocumentResponse:
    """Rasterize PDF pages into board-only image tiles (NOT ingested as Shots)."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    name = (file.filename or "doc.pdf").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="PDF only for now — export Keynote/pptx to PDF first",
        )

    raw = await file.read()
    if len(raw) > 80 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF too large (80MB max)")

    batch = uuid4().hex[:10]
    out_dir = _board_assets_dir(settings, project_id, board_id) / batch
    try:
        pages = _rasterize_pdf(raw, out_dir, max_pages=max(1, min(max_pages, 80)))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"PDF rasterize failed: {exc}") from exc

    if not pages:
        raise HTTPException(status_code=400, detail="No pages rendered")

    lib = library_root(settings)
    for p in pages:
        try:
            rel = Path(p["path"]).resolve().relative_to(lib.resolve())
            p["url"] = f"/artifacts/{rel.as_posix()}"
        except Exception:
            p["url"] = f"/artifacts/_board_assets/{project_id}/{board_id}/{batch}/{p['filename']}"

    return ImportDocumentResponse(
        board_id=board_id,
        pages=pages,
        message=f"Rasterized {len(pages)} page(s) as board-only images (not searchable)",
    )


class BundleExportRequest(BaseModel):
    canvas: dict = Field(default_factory=dict)
    board_name: str = "Board"
    # Relative artifact paths already known to the client (thumb/keyframe urls)
    media_urls: list[str] = Field(default_factory=list)


@router.post("/projects/{project_id}/boards/{board_id}/export-bundle")
async def export_bundle(
    project_id: str,
    board_id: str,
    body: BundleExportRequest,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
):
    """Build a .ckboard.zip: canvas.json + manifest + copied media files."""
    from fastapi.responses import StreamingResponse

    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    lib = library_root(settings)
    buf = io.BytesIO()
    manifest = {
        "format": "cinekive.board.v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "project_id": project_id,
        "board_id": board_id,
        "board_name": body.board_name,
        "files": [],
    }

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "canvas.json",
            json.dumps(body.canvas, indent=2, ensure_ascii=False),
        )
        for i, url in enumerate(body.media_urls):
            rel = url
            if "/artifacts/" in url:
                rel = url.split("/artifacts/", 1)[1]
            elif "/library/" in url:
                rel = url.split("/library/", 1)[1]
            elif url.startswith("/"):
                rel = url.lstrip("/")
            # strip query
            rel = rel.split("?", 1)[0]
            src = (lib / rel).resolve()
            try:
                src.relative_to(lib.resolve())
            except Exception:
                # legacy artifacts_dir
                from cinearchive.services.artifact_service import resolve_artifact

                try:
                    src = resolve_artifact(settings, rel)
                except Exception:
                    continue
            if not src.is_file():
                continue
            arc = f"media/{i:03d}_{src.name}"
            zf.write(src, arcname=arc)
            manifest["files"].append({"url": url, "archive": arc, "name": src.name})
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    filename = f"{(body.board_name or 'board').replace(' ', '-')[:40]}.ckboard.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/boards/import-bundle")
async def import_bundle(
    project_id: str,
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
):
    """Import a .ckboard.zip into board assets + return canvas JSON with remapped media URLs."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    raw = await file.read()
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Bundle too large (200MB max)")

    board_id = uuid4().hex
    dest_root = _board_assets_dir(settings, project_id, board_id) / "bundle"
    dest_root.mkdir(parents=True, exist_ok=True)
    lib = library_root(settings)

    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = set(zf.namelist())
            if "canvas.json" not in names or "manifest.json" not in names:
                raise HTTPException(status_code=400, detail="Not a Cinekive board bundle")
            canvas = json.loads(zf.read("canvas.json").decode("utf-8"))
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            url_map: dict[str, str] = {}
            for entry in manifest.get("files") or []:
                arc = entry.get("archive")
                if not arc or arc not in names:
                    continue
                out_name = Path(arc).name
                out_path = dest_root / out_name
                out_path.write_bytes(zf.read(arc))
                try:
                    rel = out_path.resolve().relative_to(lib.resolve())
                    new_url = f"/artifacts/{rel.as_posix()}"
                except Exception:
                    new_url = str(out_path)
                old = entry.get("url") or ""
                if old:
                    url_map[old] = new_url
            # Remap CanvasMedia urls
            media = canvas.get("media") or []
            for m in media:
                u = m.get("url")
                if u in url_map:
                    m["url"] = url_map[u]
            canvas["media"] = media
    except HTTPException:
        raise
    except Exception as exc:
        shutil.rmtree(dest_root, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Bundle import failed: {exc}") from exc

    return {
        "board_id": board_id,
        "canvas": canvas,
        "manifest": manifest,
        "message": "Bundle imported as board assets (review & save on a canvas)",
    }
