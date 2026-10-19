"""Token auth for non-loopback API clients (Cinekive v2).

Cinekive is local-first: the API normally listens on 127.0.0.1 and only the
desktop shell talks to it. When the user opts into LAN access the API binds to
0.0.0.0 and every device on the network can reach it, so a shared secret is
required from anything that is not loopback.

Rules
-----
* No token configured (plain ``git clone`` / docker checkout) -> open access,
  which keeps local development friction-free.
* Token configured -> non-loopback clients must send ``X-Cinekive-Token`` or
  ``Authorization: Bearer <token>``. Loopback clients (the desktop shell, the
  Next.js rewrite proxy) are trusted.
* ``/health`` and the OpenAPI docs stay reachable so installers and health
  probes keep working without a secret.
"""

from __future__ import annotations

import hmac
import logging
import os
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from cinearchive.api.public_access import is_public_tunnel

logger = logging.getLogger(__name__)

TOKEN_HEADER = "x-cinekive-token"
TOKEN_COOKIE = "cinekive_token"
TOKEN_ENV = "CINEKIVE_API_TOKEN"
TOKEN_FILE_ENV = "CINEKIVE_API_TOKEN_FILE"

# Paths that must answer without a token: health probes and API docs.
EXEMPT_PATHS: frozenset[str] = frozenset(
    {"/", "/health", "/docs", "/redoc", "/openapi.json"}
)

# Read paths that must never be reachable through a public share tunnel.
# Browsing a shared archive needs shots/projects/collections/search; anything
# that exposes machine state or job internals does not.
TUNNEL_BLOCKED_PREFIXES: tuple[str, ...] = (
    "/system",
    "/license",
    "/ingest",
    "/jobs",
    "/enrich",
    "/sources",
    "/seek",
    "/board",
)


def _read_token_file() -> str:
    raw = (os.environ.get(TOKEN_FILE_ENV) or "").strip()
    if not raw:
        return ""
    try:
        return Path(raw).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def expected_token() -> str:
    """The configured shared secret, or "" when the API is running unprotected."""
    token = (os.environ.get(TOKEN_ENV) or "").strip()
    if token:
        return token
    return _read_token_file()


def is_loopback_client(request: Request) -> bool:
    """True when the TCP peer is this machine."""
    client = request.client
    host = (client.host if client else "") or ""
    host = host.replace("[", "").replace("]", "").split("%")[0].strip().lower()
    if host in {"", "localhost", "::1"}:
        return True
    return host.startswith("127.")


def extract_token(request: Request) -> str:
    header = (request.headers.get(TOKEN_HEADER) or "").strip()
    if header:
        return header
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    # Cookies are not port-scoped, so the browser sends the same cookie to the
    # API on :8000 — this is what lets <img> tags load stills from a phone.
    cookie = (request.cookies.get(TOKEN_COOKIE) or "").strip()
    if cookie:
        return cookie
    return ""


def token_matches(request: Request, token: str) -> bool:
    provided = extract_token(request)
    if not provided:
        return False
    return hmac.compare_digest(provided, token)


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """Require the shared secret from non-loopback clients when one is set."""

    async def dispatch(self, request: Request, call_next):
        token = expected_token()
        if not token:
            # Unprotected mode (dev checkout). Nothing to enforce.
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        if is_loopback_client(request):
            return await call_next(request)
        if token_matches(request, token):
            return await call_next(request)

        logger.warning(
            "Rejected unauthenticated %s %s from %s",
            request.method,
            request.url.path,
            request.client.host if request.client else "?",
        )
        return JSONResponse(
            status_code=401,
            content={
                "detail": (
                    "This Cinekive server requires an access token for network "
                    "devices. Enter the token shown in the desktop app."
                ),
                "code": "token_required",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )


def _is_tunnel_request(request: Request) -> bool:
    return is_public_tunnel(
        request.headers.get("host") or "",
        request.headers.get("x-forwarded-host") or "",
        request.headers.get("cf-ray"),
    )


class SecurityMiddleware(BaseHTTPMiddleware):
    """Single pass for the two public-exposure rules.

    1. A public share tunnel is read-only: no writes, and no machine-state
       reads (``/system``, ``/license``, ``/jobs``, ...).
    2. Non-loopback clients need the shared token when one is configured.
    """

    async def dispatch(self, request: Request, call_next):
        tunnel = _is_tunnel_request(request)
        method = request.method
        path = request.url.path

        if tunnel:
            if method not in {"GET", "HEAD", "OPTIONS"}:
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": (
                            "This public link is read-only. Ingest and edits stay "
                            "on the machine running Cinekive."
                        ),
                        "code": "tunnel_read_only",
                    },
                )
            blocked = next(
                (p for p in TUNNEL_BLOCKED_PREFIXES if path.startswith(p)),
                None,
            )
            if blocked:
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "This endpoint is not available on a public share link.",
                        "code": "tunnel_blocked",
                    },
                )

        token = expected_token()
        if token and method != "OPTIONS" and path not in EXEMPT_PATHS:
            if not is_loopback_client(request) and not token_matches(request, token):
                logger.warning(
                    "Rejected unauthenticated %s %s from %s",
                    method,
                    path,
                    request.client.host if request.client else "?",
                )
                return JSONResponse(
                    status_code=401,
                    content={
                        "detail": (
                            "This Cinekive server requires an access token for "
                            "network devices. Enter the token shown in the "
                            "desktop app."
                        ),
                        "code": "token_required",
                    },
                    headers={"WWW-Authenticate": "Bearer"},
                )

        return await call_next(request)
