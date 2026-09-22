import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.config import settings, validate_secret_key
from core.exceptions import (
    global_exception_handler,
    validation_exception_handler,
    integrity_error_handler,
)
from core.logging import setup_logging
from api.v1.router import api_router
from db.session import engine
from services.audit import setup_audit_listeners

logger = logging.getLogger("hms")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate config, configure logging, then seed permissions + first admin."""
    validate_secret_key(settings)
    setup_logging()

    from db.session import SessionLocal
    from services.permissions import run_bootstrap

    db = SessionLocal()
    try:
        run_bootstrap(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="HMS MMA — Havyaka MahaSabha Membership Management API",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)


# ── Request context: X-Request-ID + access log ─────────────
@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled error on %s %s [rid=%s]",
            request.method,
            request.url.path,
            request_id,
        )
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "%s %s -> %s in %.1fms [rid=%s]",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    return response


# ── Middleware ──────────────────────────────
_origins = settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # Browsers reject wildcard origins on credentialed requests, so only allow
    # credentials when specific origins are configured.
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Exception Handlers ──────────────────────
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(IntegrityError, integrity_error_handler)

# NOTE: uploaded files are NOT served statically anymore — /uploads was
# world-readable. Use the authenticated GET /api/v1/system/files endpoint.

# ── Auto Audit Listeners ───────────────────
setup_audit_listeners(engine)

# ── API Routes ───────────────────────────────
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    return {"app": settings.PROJECT_NAME, "version": "1.0.0", "docs": f"{settings.API_V1_STR}/docs"}


@app.get("/health")
def health():
    """Liveness + database connectivity probe."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.error("Health check failed: database unreachable", exc_info=True)
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "database": "error"},
        )
    return {"status": "healthy", "database": "ok"}
