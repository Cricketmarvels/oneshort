"""FastAPI application factory."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.common.media_sign import media_signer
from app.core.config import Settings, get_settings
from app.core.container import Container, build_container
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger
from app.core.middleware import (
    BodySizeLimitMiddleware,
    NoSqlInjectionGuardMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.observability import init_sentry
from app.core.security import decode_access_token
from app.infrastructure.database.indexes import ensure_indexes
from app.modules.agreements.service import AgreementService
from app.modules.search.indexer import SearchIndexer

log = get_logger("app")


def _error(request: Request, status: int, code: str, message: str, details: list[object] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "details": details or []},
            "request_id": getattr(request.state, "request_id", None),
        },
    )


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=not settings.debug)
    init_sentry(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        c: Container = app.state.container
        await ensure_indexes(c.mongo)
        await AgreementService(c).seed_default()
        await SearchIndexer(c.mongo).ensure_populated()
        task: asyncio.Task[None] | None = None
        if settings.scheduler_enabled:
            from app.modules.matches.scheduler import run_scheduler

            task = asyncio.create_task(run_scheduler(c))
        log.info("startup", env=settings.app_env, ai_enabled=c.ai.enabled, push=c.push.configured)
        yield
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        await c.mongo.close()

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description=(
            "Hyperlocal cricket matchmaking & team management API. All responses use the envelope "
            "`{data, meta?}`; errors use `{error: {code, message, details}, request_id}`."
        ),
        lifespan=lifespan,
        openapi_url=f"{settings.api_prefix}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.state.container = container or build_container(settings)
    app.state.settings = settings
    media_signer.configure(settings.jwt_secret, settings.api_prefix, settings.media_link_ttl_seconds)

    # Middleware (last added = outermost)
    app.add_middleware(NoSqlInjectionGuardMiddleware)
    app.add_middleware(BodySizeLimitMiddleware, settings=settings)
    app.add_middleware(RateLimitMiddleware, settings=settings, limiter=app.state.container.limiter)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return _error(request, exc.status_code, exc.code, exc.message, list(exc.details))

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        details: list[object] = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"], "type": e["type"]}
            for e in exc.errors()
        ]
        return _error(request, 422, "VALIDATION_ERROR", "Request validation failed", details)

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return _error(request, exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", error=type(exc).__name__)
        return _error(request, 500, "INTERNAL_ERROR", "Something went wrong")

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/health/live", tags=["Health"])
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["Health"])
    async def ready() -> JSONResponse:
        try:
            topo = await app.state.container.mongo.topology()
            if not topo["writable_primary"]:  # election in progress: still serve reads, flag for monitoring
                return JSONResponse({"status": "degraded", "database": "no_primary"}, status_code=200)
            return JSONResponse({"status": "ok", "database": "ok"})
        except Exception:  # noqa: BLE001
            return JSONResponse({"status": "degraded", "database": "unreachable"}, status_code=503)

    @app.websocket(f"{settings.api_prefix}/ws")
    async def ws(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token", "")
        try:
            payload = decode_access_token(settings, token)
        except AppError:
            await websocket.close(code=4401)
            return
        await websocket.accept()
        hub = app.state.container.hub
        uid = payload["sub"]
        await hub.connect(uid, websocket)
        try:
            while True:
                await websocket.receive_text()  # keep-alive pings from client
        except WebSocketDisconnect:
            pass
        finally:
            hub.disconnect(uid, websocket)

    if settings.storage_provider == "local":
        Path(settings.local_upload_dir).mkdir(parents=True, exist_ok=True)
        # No public mount: files are served only through the signed /media endpoint (app/modules/media).

    return app


# Run with: uvicorn app.main:create_app --factory
