"""In-app Gemi Local AI chat — local VLM + tools that act on the archive."""

from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.pipelines.embedding import EmbeddingPipeline
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.collection import CollectionCreate
from cinearchive.schemas.search import MoodboardRequest, SearchRequest
from cinearchive.services.collection_service import CollectionService
from cinearchive.services.llm_text import complete_text, load_craft_system_prompt
from cinearchive.services.project_service import ProjectService
from cinearchive.services.search_service import SearchService
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

ChatRole = Literal["user", "assistant", "system"]
ActionType = Literal["open_search", "open_collection", "open_project", "navigate", "open_generate"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(max_length=8000)


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    project_id: UUID | None = None
    history: list[ChatMessage] = Field(default_factory=list, max_length=24)
    create_board: bool = True


class ChatAction(BaseModel):
    type: ActionType
    label: str
    href: str | None = None
    query: str | None = None
    prompt: str | None = None
    collection_id: str | None = None
    project_id: str | None = None
    shot_ids: list[str] = Field(default_factory=list)


class AgentChatResponse(BaseModel):
    reply: str
    intent: str
    actions: list[ChatAction] = Field(default_factory=list)
    shot_ids: list[str] = Field(default_factory=list)
    used_vlm: bool = False
    model_online: bool = False


def _intent(message: str) -> str:
    m = message.lower().strip()
    if re.search(
        r"^(hi|hello|hey|yo|sup)\b|are you (there|up|online|working)|^ping$|^test$",
        m,
    ) and not re.search(r"\b(find|search|moodboard|generate|summary|how many)\b", m):
        return "hello"
    if re.search(r"\b(moodboard|lookbook|pitch|logline|board from|create (a )?board|make (a )?board)\b", m):
        return "moodboard"
    if re.search(
        r"\b(generate|img2img|variations?|variant|make (an? )?(image|still)|gen (a |me )?)\b",
        m,
    ):
        return "generate"
    if re.search(
        r"\b(how many|summary|overview|what('s| is) in|stats|status|libraries|archives|inventory)\b",
        m,
    ):
        return "summary"
    if re.search(
        r"\b(find|search|show|frames?|shots?|stills?|look for|pull|similar|neon|wide|close.?up)\b",
        m,
    ):
        return "search"
    return "chat"


"""Conversational filler that must not reach the search index.

Chat arrives as a sentence ("find me some neon night wides"), but the keyword index
matches literal tokens — a stray "find" ANDs against every row and returns nothing.
"""
_QUERY_NOISE = re.compile(
    r"\b(please|can you|could you|i want|i need|show me|find me|give me|pull up|pull|"
    r"find|search|search for|look for|show|get|fetch|bring|list|display|"
    r"some|any|a few|me|us|for|from|with|that|which|are|is|the|of|and|"
    r"frames?|shots?|stills?|images?|photos?|pictures?|clips?|"
    r"moodboard|lookbook|board|archive|library)\b",
    re.I,
)


def _clean_query(message: str) -> str:
    """Reduce a chat sentence to the craft terms worth searching."""
    q = _QUERY_NOISE.sub(" ", message or "")
    q = re.sub(r"[?!.,;:]+", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    # If stripping removed everything meaningful, fall back to the raw text.
    return q if len(q) >= 2 else (message or "").strip()


def _empty_canvas(positions: dict[str, dict[str, float | int]]) -> dict[str, Any]:
    return {
        "positions": positions,
        "groups": [],
        "edges": [],
        "notes": [],
        "texts": [],
        "media": [],
        "stacks": [],
        "gens": [],
        "view": {"x": 80, "y": 80, "scale": 1},
    }


class AgentChatService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        vector_repo: VectorRepository,
        embedder: EmbeddingPipeline | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.search = SearchService(session, settings, vector_repo, embedder)
        self.projects = ProjectService(session, settings, vector_repo)
        self.collections = CollectionService(session)

    async def chat(self, req: AgentChatRequest) -> AgentChatResponse:
        intent = _intent(req.message)
        context = await self._library_context(req.project_id)
        craft = load_craft_system_prompt()

        if intent == "hello":
            reply = await self._maybe_vlm(
                req,
                system=craft + "\n\nGreet briefly and offer one example command.",
                fallback=(
                    f"Here — Gemi Local AI is up. {context['summary_text'].split(chr(10))[0]}.\n\n"
                    "Try: “summary”, “find neon wide night”, or “moodboard: rain courier”."
                ),
                extra_user=f"Library context:\n{context['summary_text']}\n\nUser: {req.message}",
            )
            return AgentChatResponse(
                reply=reply[0],
                intent=intent,
                actions=[
                    ChatAction(type="navigate", label="Archives", href="/archives"),
                    ChatAction(type="navigate", label="Discovery", href="/"),
                ],
                used_vlm=reply[1],
                model_online=reply[1],
            )

        if intent == "summary":
            reply = await self._maybe_vlm(
                req,
                system=craft + "\n\nBe concise. Use the library context. Suggest one useful next step.",
                fallback=context["summary_text"]
                + "\n\nTry “find …” for frames or “moodboard: …” on a project.",
                extra_user=f"Library context:\n{context['summary_text']}\n\nUser: {req.message}",
            )
            return AgentChatResponse(
                reply=reply[0],
                intent=intent,
                actions=[
                    ChatAction(type="navigate", label="Open Archives", href="/archives"),
                ],
                used_vlm=reply[1],
                model_online=reply[1],
            )

        if intent == "moodboard":
            return await self._moodboard(req, context, craft)

        if intent == "generate":
            return await self._generate(req, context, craft)

        if intent == "search":
            return await self._search(req, context, craft)

        # General chat with optional light search hint
        reply = await self._maybe_vlm(
            req,
            system=craft,
            fallback=(
                f"{context['summary_text']}\n\n"
                "I can search frames, summarize archives, build a moodboard, or seed a Generate node. "
                "Try: “find neon wide night exteriors”, “summary”, or “moodboard: lonely courier in rain”."
            ),
            extra_user=f"Library context:\n{context['summary_text']}\n\nUser: {req.message}",
        )
        return AgentChatResponse(
            reply=reply[0],
            intent=intent,
            used_vlm=reply[1],
            model_online=reply[1],
        )

    async def _library_context(self, project_id: UUID | None) -> dict[str, Any]:
        projects = await self.projects.list()
        total = sum(p.shot_count for p in projects)
        archives = [p for p in projects if (p.kind or "").lower() == "archive" or "archive" in (p.slug or "")]
        lines = [
            f"{len(projects)} projects · {total:,} frames indexed",
        ]
        if archives:
            lines.append(
                "Archives: "
                + ", ".join(f"{a.name} ({a.shot_count:,})" for a in archives[:8])
            )
        focus = None
        if project_id:
            focus = next((p for p in projects if str(p.id) == str(project_id)), None)
            if focus:
                lines.append(
                    f"Focused project: {focus.name} · {focus.shot_count:,} frames · kind={focus.kind}"
                )
                if focus.brief:
                    lines.append(f"Brief: {focus.brief[:280]}")
                if focus.feeling:
                    lines.append(f"Feeling: {focus.feeling}")
        top = sorted(projects, key=lambda p: p.shot_count, reverse=True)[:6]
        if top:
            lines.append(
                "Largest: " + ", ".join(f"{p.name} ({p.shot_count:,})" for p in top)
            )
        return {
            "summary_text": "\n".join(lines),
            "projects": projects,
            "focus": focus,
            "total": total,
        }

    async def _search(
        self, req: AgentChatRequest, context: dict[str, Any], craft: str
    ) -> AgentChatResponse:
        cleaned = _clean_query(req.message)
        res = await self.search.search(
            SearchRequest(query=cleaned, project_id=req.project_id, limit=12)
        )
        # Retry unscoped: a project filter often hides the only matches.
        if not res.results and req.project_id:
            res = await self.search.search(SearchRequest(query=cleaned, limit=12))
        ids = [str(r.shot.id) for r in res.results]
        titles = []
        for r in res.results[:5]:
            t = r.shot.source_title or (r.shot.source_meta or {}).get("film_title") or r.shot.shot_type
            titles.append(str(t or "frame")[:48])
        fallback = (
            f"Found {len(res.results)} frames for “{cleaned[:80]}”."
            + (
                f" Top: {', '.join(titles)}."
                if titles
                else " Nothing matched. If the library was just ingested, run Reindex so "
                "visual search can see these frames."
            )
        )
        reply = await self._maybe_vlm(
            req,
            system=(
                craft
                + "\n\nSummarize search results in 2-3 sentences. "
                f"Result count: {len(res.results)}. Titles/labels: {', '.join(titles) or 'none'}."
            ),
            fallback=fallback,
            extra_user=req.message,
        )
        q = cleaned[:120]
        return AgentChatResponse(
            reply=reply[0],
            intent="search",
            actions=[
                ChatAction(
                    type="open_search",
                    label="Show in Discovery",
                    href=f"/?q={q}",
                    query=q,
                    shot_ids=ids,
                )
            ],
            shot_ids=ids,
            used_vlm=reply[1],
            model_online=reply[1],
        )

    async def _moodboard(
        self, req: AgentChatRequest, context: dict[str, Any], craft: str
    ) -> AgentChatResponse:
        pitch = req.message
        pitch = re.sub(
            r"^(make|create|build)\s+(me\s+)?(a\s+)?(moodboard|lookbook|board)\s*(from|for|with|:)?\s*",
            "",
            pitch,
            flags=re.I,
        ).strip() or req.message

        pitch = _clean_query(pitch) or pitch

        mb = await self.search.moodboard(
            MoodboardRequest(text=pitch, project_id=req.project_id, limit=18)
        )
        # Score 0 means the vector index returned arbitrary rows (unindexed library),
        # so pinning them produces a board of unrelated frames.
        scored = [r for r in mb.results if r.score > 0]
        stale_index = bool(mb.results) and not scored
        ids = [str(r.shot.id) for r in scored]
        actions: list[ChatAction] = []
        collection_id = None
        project_id = str(req.project_id) if req.project_id else None

        if req.create_board and ids and req.project_id:
            positions: dict[str, dict[str, float | int]] = {}
            cols = 6
            for i, sid in enumerate(ids[:18]):
                positions[sid] = {
                    "x": 40 + (i % cols) * 200,
                    "y": 40 + (i // cols) * 160,
                    "w": 180,
                }
            name = f"Gemi · {pitch[:42]}" if pitch else "Gemi moodboard"
            col = await self.collections.create(
                CollectionCreate(
                    name=name.strip()[:80] or "Gemi moodboard",
                    description=f"Built from chat: {pitch[:240]}",
                    project_id=req.project_id,
                    kind="canvas",
                    meta={"canvas": _empty_canvas(positions), "craft_chat": True},
                )
            )
            await self.collections.add_shots(col.id, [UUID(s) for s in ids])
            collection_id = str(col.id)
            project_id = str(req.project_id)
            actions.append(
                ChatAction(
                    type="open_collection",
                    label="Open moodboard",
                    href=f"/projects/{project_id}?view=canvas&board={collection_id}",
                    collection_id=collection_id,
                    project_id=project_id,
                    shot_ids=ids,
                )
            )
        elif ids:
            actions.append(
                ChatAction(
                    type="open_search",
                    label="Browse picks",
                    href=f"/?q={pitch[:80]}",
                    query=pitch[:120],
                    shot_ids=ids,
                )
            )

        concepts = ", ".join(mb.concepts[:6]) if mb.concepts else pitch[:80]
        if stale_index:
            fallback = (
                "I found frames but none actually matched “"
                + pitch[:60]
                + "” — this library has no visual index yet, so I'd be pinning random shots. "
                "Run Reindex (Settings → Library), then ask again."
            )
        else:
            fallback = (
                f"Curated {len(ids)} frames"
                + (" onto a moodboard" if collection_id else "")
                + f". Concepts: {concepts or '—'}."
                + (" Open the board from the action below." if collection_id else "")
                + (
                    ""
                    if req.project_id
                    else " Tip: open a project first so I can pin a canvas board."
                )
            )
        reply = await self._maybe_vlm(
            req,
            system=(
                craft
                + "\n\nConfirm the moodboard in 2 sentences. "
                f"Shot count: {len(ids)}. Concepts: {concepts}."
            ),
            fallback=fallback,
            extra_user=pitch,
        )
        return AgentChatResponse(
            reply=reply[0],
            intent="moodboard",
            actions=actions,
            shot_ids=ids,
            used_vlm=reply[1],
            model_online=reply[1],
        )

    async def _generate(
        self, req: AgentChatRequest, context: dict[str, Any], craft: str
    ) -> AgentChatResponse:
        prompt = req.message
        prompt = re.sub(
            r"^(generate|make|create|gen)\s+(me\s+)?(an?\s+)?(image|still|variant|variation)?\s*(of|from|with|:)?\s*",
            "",
            prompt,
            flags=re.I,
        ).strip() or req.message.strip()
        project_id = str(req.project_id) if req.project_id else None
        href = f"/projects/{project_id}?view=canvas" if project_id else None
        fallback = (
            f"Seeded a Generate node with: “{prompt[:120]}”. "
            + (
                "Open the moodboard and link a reference frame, then Run (Pro)."
                if project_id
                else "Open a project moodboard first, then ask again."
            )
        )
        reply = await self._maybe_vlm(
            req,
            system=(
                craft
                + "\n\nConfirm placing a Generate node. Remind them to link a reference still "
                "and Run (Pro). 2 sentences max."
            ),
            fallback=fallback,
            extra_user=prompt,
        )
        actions: list[ChatAction] = [
            ChatAction(
                type="open_generate",
                label="Place Generate node",
                href=href,
                prompt=prompt[:800],
                project_id=project_id,
            )
        ]
        return AgentChatResponse(
            reply=reply[0],
            intent="generate",
            actions=actions,
            used_vlm=reply[1],
            model_online=reply[1],
        )

    async def _maybe_vlm(
        self,
        req: AgentChatRequest,
        *,
        system: str,
        fallback: str,
        extra_user: str | None = None,
    ) -> tuple[str, bool]:
        # Skip the canned welcome line so it doesn't pollute the model context
        history = [
            {"role": m.role, "content": m.content[:2000]}
            for m in req.history[-10:]
            if m.role in {"user", "assistant"}
            and not m.content.startswith("Craft chat —")
        ]
        history.append({"role": "user", "content": (extra_user or req.message)[:4000]})
        text = await complete_text(self.settings, system=system, messages=history)
        if text:
            return text.strip(), True
        return fallback.strip(), False
