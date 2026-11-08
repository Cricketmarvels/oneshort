"""HTTP middleware: request IDs, access logging, security headers, rate limiting,
and a NoSQL-injection safety net for JSON bodies."""

import json
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("http")
Call = Callable[[Request], Awaitable[Response]]


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Call) -> Response:
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        if len(request_id) > 64:
            request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["X-Request-ID"] = request_id
        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next: Call) -> Response:
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if not request.url.path.startswith(("/docs", "/redoc")):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if self.settings.app_env == "production":
            h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        return response


class InMemoryRateLimiter:
    """Sliding-window limiter. Swap for a Redis implementation when running >1 instance."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, limit: int, window_s: float = 60.0) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window_s:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, settings: Settings, limiter: InMemoryRateLimiter) -> None:
        super().__init__(app)
        self.settings = settings
        self.limiter = limiter

    async def dispatch(self, request: Request, call_next: Call) -> Response:
        ip = request.client.host if request.client else "unknown"
        path = request.url.path
        is_auth = "/auth/" in path
        group = "auth" if is_auth else "default"
        limit = self.settings.rate_limit_auth_per_minute if is_auth else self.settings.rate_limit_default_per_minute
        if request.method != "OPTIONS" and not self.limiter.hit(f"{group}:{ip}", limit):
            return JSONResponse(
                status_code=429,
                content={
                    "error": {"code": "RATE_LIMITED", "message": "Too many requests", "details": []},
                    "request_id": getattr(request.state, "request_id", None),
                },
                headers={"Retry-After": "60"},
            )
        return await call_next(request)


def _has_operator_keys(value: Any) -> bool:
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(k, str) and (k.startswith("$") or "." in k):
                return True
            if _has_operator_keys(v):
                return True
    elif isinstance(value, list):
        return any(_has_operator_keys(v) for v in value)
    return False


class NoSqlInjectionGuardMiddleware(BaseHTTPMiddleware):
    """Defence in depth: reject JSON bodies containing Mongo operator-like keys.

    Primary protection is that all queries are built from typed Pydantic values.
    """

    async def dispatch(self, request: Request, call_next: Call) -> Response:
        if request.method in ("POST", "PUT", "PATCH") and request.headers.get("content-type", "").startswith(
            "application/json"
        ):
            body = await request.body()
            if body:
                try:
                    parsed = json.loads(body)
                except ValueError:
                    parsed = None
                if parsed is not None and _has_operator_keys(parsed):
                    return JSONResponse(
                        status_code=400,
                        content={
                            "error": {
                                "code": "INVALID_INPUT",
                                "message": "Field names may not start with '$' or contain '.'",
                                "details": [],
                            },
                            "request_id": getattr(request.state, "request_id", None),
                        },
                    )
        return await call_next(request)
