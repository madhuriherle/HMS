from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone
import logging
import traceback

logger = logging.getLogger("hms.errors")


class InUseError(HTTPException):
    """409: the record is referenced elsewhere. `detail` stays a plain message so any client can
    show it; the web app also reads `code` / `can_force` to offer "delete anyway"."""

    def __init__(self, message: str, can_force: bool = True):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=message)
        self.can_force = can_force


async def in_use_error_handler(request: Request, exc: InUseError):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": exc.detail, "code": "IN_USE", "can_force": exc.can_force},
    )

async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions, log to system_error_logs and return clean JSON."""
    tb = traceback.format_exc()
    logger.error("Unhandled error on %s: %s", request.url, exc, exc_info=True)
    try:
        from db.session import SessionLocal
        from models.system import SystemErrorLog
        db = SessionLocal()
        log = SystemErrorLog(
            error_message=str(exc),
            stack_trace=tb,
            endpoint=str(request.url),
            created_at=datetime.now(timezone.utc)
        )
        db.add(log)
        db.commit()
        db.close()
    except Exception:
        pass  # Don't fail the error handler itself

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal server error occurred. It has been logged."}
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return clean validation error messages."""
    errors = []
    for error in exc.errors():
        errors.append({
            "field": " -> ".join(str(loc) for loc in error["loc"]),
            "message": error["msg"]
        })
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error", "errors": errors}
    )

async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Turn DB unique / foreign-key / not-null violations into a clear 409."""
    raw = str(getattr(exc, "orig", exc)).lower()
    if "foreign key" in raw:
        detail = "This record is linked to other records (or points to one that no longer exists), so the action was blocked."
    elif "unique" in raw or "duplicate" in raw:
        detail = "A record with the same code / number / name already exists."
    elif "not null" in raw or "null value" in raw:
        detail = "A required field is missing."
    else:
        detail = "Database integrity error. Possibly a duplicate entry."
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": detail})
