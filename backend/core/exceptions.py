from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone
import logging
import traceback

logger = logging.getLogger("hms.errors")

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
    """Handle DB unique constraint / FK violations cleanly."""
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Database integrity error. Possibly a duplicate entry."}
    )
