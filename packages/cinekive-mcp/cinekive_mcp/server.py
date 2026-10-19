"""Cinekive MCP server — Pro agents talk to your local archive.

Requires Cinekive API running (default http://127.0.0.1:8000) and a Pro license
(or CINEKIVE_TIER=pro for self-built).

Install::

    pip install -e packages/cinekive-mcp

Cursor / Claude Desktop mcp.json::

    {
      "mcpServers": {
        "cinekive": {
          "command": "cinekive-mcp",
          "env": {
            "CINEKIVE_API_URL": "http://127.0.0.1:8000"
          }
        }
      }
    }
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import httpx

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:  # newer SDK naming
    from mcp.server import MCPServer as FastMCP  # type: ignore

API_URL = os.environ.get("CINEKIVE_API_URL", "http://127.0.0.1:8000").rstrip("/")

mcp = FastMCP("Cinekive")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=120.0)


def _require_pro() -> None:
    with _client() as c:
        r = c.get("/license/entitlements")
        r.raise_for_status()
        data = r.json()
    features = set(data.get("features") or [])
    if data.get("is_pro") or "mcp_server" in features or "agent_api" in features:
        return
    raise RuntimeError(
        "Cinekive MCP requires Pro. Activate in Settings → License, or set CINEKIVE_TIER=pro."
    )


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
def library_summary() -> str:
    """Summarize projects and frame counts in the local Cinekive library."""
    _require_pro()
    with _client() as c:
        r = c.get("/projects")
        r.raise_for_status()
        projects = r.json()
    if isinstance(projects, dict):
        projects = projects.get("items") or projects.get("projects") or []
    total = sum(int(p.get("shot_count") or 0) for p in projects)
    lines = [f"{len(projects)} projects · {total:,} frames"]
    for p in sorted(projects, key=lambda x: int(x.get("shot_count") or 0), reverse=True)[:20]:
        lines.append(
            f"- {p.get('name')} [{p.get('kind')}] id={p.get('id')} · {p.get('shot_count')} frames"
        )
    return "\n".join(lines)


@mcp.tool()
def search_shots(query: str, project_id: str | None = None, limit: int = 12) -> str:
    """Semantic / hybrid search across cinematic stills."""
    _require_pro()
    body: dict[str, Any] = {"query": query, "limit": min(max(limit, 1), 48)}
    if project_id:
        body["project_id"] = project_id
    with _client() as c:
        r = c.post("/search", json=body)
        r.raise_for_status()
        data = r.json()
    rows = []
    for item in data.get("results") or []:
        shot = item.get("shot") or {}
        rows.append(
            {
                "id": shot.get("id"),
                "score": item.get("score"),
                "title": shot.get("source_title"),
                "shot_type": shot.get("shot_type"),
                "mood": shot.get("mood_vibe"),
                "film": (shot.get("source_meta") or {}).get("film_title"),
                "project_id": shot.get("project_id"),
            }
        )
    return _json({"total": data.get("total"), "results": rows})


@mcp.tool()
def agent_query(prompt: str, project_id: str | None = None, limit: int = 8) -> str:
    """Natural-language agent query (Pro Agent API) — interpret craft language + search."""
    _require_pro()
    body: dict[str, Any] = {"prompt": prompt, "limit": min(max(limit, 1), 50)}
    if project_id:
        body["project_id"] = project_id
    with _client() as c:
        r = c.post("/agent/query", json=body)
        r.raise_for_status()
        return _json(r.json())


@mcp.tool()
def craft_chat(message: str, project_id: str | None = None) -> str:
    """Chat with Gemi Local AI tools: archive summary, search, moodboard creation."""
    _require_pro()
    body: dict[str, Any] = {"message": message, "create_board": True}
    if project_id:
        body["project_id"] = project_id
    with _client() as c:
        r = c.post("/agent/chat", json=body)
        r.raise_for_status()
        return _json(r.json())


@mcp.tool()
def create_moodboard(pitch: str, project_id: str, limit: int = 18) -> str:
    """Build a moodboard from a pitch/logline and pin frames to a canvas collection."""
    _require_pro()
    with _client() as c:
        r = c.post(
            "/agent/chat",
            json={
                "message": f"moodboard: {pitch}",
                "project_id": project_id,
                "create_board": True,
            },
        )
        r.raise_for_status()
        return _json(r.json())


@mcp.tool()
def list_projects() -> str:
    """List all Cinekive projects with ids and kinds."""
    _require_pro()
    with _client() as c:
        r = c.get("/projects")
        r.raise_for_status()
        return _json(r.json())


def main() -> None:
    try:
        _require_pro()
    except Exception as exc:  # noqa: BLE001
        print(f"cinekive-mcp: {exc}", file=sys.stderr)
        # Still start — tools will re-check; helps Cursor connect while API boots
    mcp.run()


if __name__ == "__main__":
    main()
