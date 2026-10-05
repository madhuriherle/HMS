from typing import Any, Union
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from api import deps
from core.config import settings
from models.users import User
from models.system import FileAttachment, SystemErrorLog
from models.system import OrganisationSettings as OrganisationSettingsModel
from schemas.system import OrganisationSettings as OrganisationSettingsSchema
from schemas.system import OrganisationSettingsUpdate
from schemas.common import PendingApproval
from services import approval_gate
from db.seed_defaults import seed_organisation_settings
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

# ── Organisation settings (singleton row) ───────────────────

@router.get("/settings", response_model=OrganisationSettingsSchema)
def read_organisation_settings(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Organisation profile, contact, print-header and notification settings.

    The singleton row is created with the receipt-book defaults on first
    read, so the screen is populated out of the box."""
    seed_organisation_settings(db)
    return db.query(OrganisationSettingsModel).filter(OrganisationSettingsModel.id == 1).first()

@router.put("/settings", response_model=Union[OrganisationSettingsSchema, PendingApproval])
@approval_gate.gated("system", "UPDATE", "OrganisationSettings", "system.write")
def update_organisation_settings(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("system.write")),
    settings_in: OrganisationSettingsUpdate,
) -> Any:
    """Patch the organisation settings (partial update — only the fields
    sent in the body change)."""
    seed_organisation_settings(db)
    row = db.query(OrganisationSettingsModel).filter(OrganisationSettingsModel.id == 1).first()
    for k, v in settings_in.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    row.updated_by = current_user.id
    db.commit(); db.refresh(row)
    return row
