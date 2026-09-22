from typing import Any
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from api import deps
from core.config import settings
from models.users import User
from models.system import FileAttachment, SystemErrorLog
from core.pagination import paginate

router = APIRouter()

@router.get("/files")
def download_file(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    path: str,
) -> Any:
    """Download an uploaded file (authenticated replacement for /uploads).

    ``path`` may be the stored value (e.g. ``uploads/member_photos/x.png``)
    or a path relative to UPLOAD_DIR. Traversal outside UPLOAD_DIR is rejected.
    """
    base = os.path.abspath(settings.UPLOAD_DIR)
    relative = (path or "").replace("\\", "/")
    upload_prefix = settings.UPLOAD_DIR.rstrip("/\\") .replace("\\", "/") + "/"
    if relative.startswith(upload_prefix):
        relative = relative[len(upload_prefix):]
    relative = relative.lstrip("/")

    target = os.path.abspath(os.path.join(base, *relative.split("/")))
    if target != base and not target.startswith(base + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)

@router.get("/attachments")
def read_attachments(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    entity_type: str = None,
    page: int = 1, limit: int = 20
) -> Any:
    q = db.query(FileAttachment)
    if entity_type:
        q = q.filter(FileAttachment.entity_type == entity_type)
    return paginate(q, page, limit)

@router.get("/error-logs")
def read_error_logs(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20
) -> Any:
    return paginate(
        db.query(SystemErrorLog).order_by(SystemErrorLog.created_at.desc()),
        page, limit
    )
