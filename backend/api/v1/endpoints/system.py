from typing import Any, Union
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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
from services.file_upload import save_upload
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
    return paginate(q.order_by(FileAttachment.id.desc()), page, limit)

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

@router.post("/settings/logo", response_model=OrganisationSettingsSchema)
# Not @approval_gate.gated: an UploadFile's bytes can't be captured into a
# JSON payload and replayed later.
async def upload_organisation_logo(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("system.write")),
    file: UploadFile = File(...),
) -> Any:
    """Upload the organisation logo shown in the receipt print header.

    Stores the file under ``uploads/org_logo/`` and points
    ``logo_path`` at it (retrievable via GET /system/files?path=...).
    Any previously uploaded logo file is deleted from disk."""
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Logo must be an image (jpeg, png or webp)")
    seed_organisation_settings(db)
    row = db.query(OrganisationSettingsModel).filter(OrganisationSettingsModel.id == 1).first()
    meta = await save_upload(file, subfolder="org_logo")
    replaced = row.logo_path
    row.logo_path = meta["file_path"]
    row.updated_by = current_user.id
    db.commit(); db.refresh(row)
    if replaced and replaced != row.logo_path:
        try:
            os.remove(replaced)
        except OSError:
            pass  # best-effort cleanup of the superseded file
    return row


# ── Number formats (member ID, membership number, receipt number) ──────────
from datetime import date as _date  # noqa: E402
from typing import Optional as _Optional  # noqa: E402

from pydantic import BaseModel  # noqa: E402

from services import numbering  # noqa: E402


class NumberFormatIn(BaseModel):
    prefix: str = ""
    date_part: str = "NONE"
    separator: str = "-"
    digits: int = 6
    start_value: int = 1
    restart: str = "NEVER"
    suffix: str = ""
    allow_manual: bool = True


def _format_view(f: "numbering.Fmt", db: Session, with_next: bool = True) -> dict:
    today = _date.today()
    data = {
        "doc_type": f.doc_type,
        "label": numbering.DOC_LABELS[f.doc_type],
        "prefix": f.prefix, "date_part": f.date_part, "separator": f.separator, "digits": f.digits,
        "start_value": f.start_value, "restart": f.restart, "suffix": f.suffix, "allow_manual": f.allow_manual,
        "example": numbering.render(f, today, f.start_value),
    }
    if with_next:
        data["next_number"] = numbering.peek_number(db, f.doc_type, today)
    return data


@router.get("/number-formats")
def read_number_formats(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.read")),
) -> Any:
    return {
        "data": [_format_view(numbering.get_format(db, d), db) for d in numbering.DOC_LABELS],
        "options": {
            "date_parts": [{"value": k, "label": v} for k, v in numbering.DATE_PARTS.items()],
            "restarts": [{"value": k, "label": v} for k, v in numbering.RESTARTS.items()],
            "separators": numbering.SEPARATORS,
            "allowed_dates": {k: sorted(v) for k, v in numbering.ALLOWED_DATE_PARTS.items()},
            "yearly_plain_docs": list(numbering.YEARLY_PLAIN_DOCS),   # these may restart every financial year with no date in the number
        },
    }


@router.get("/number-formats/{doc_type}/preview")
def preview_number_format(
    doc_type: str,
    prefix: str = "", date_part: str = "NONE", separator: str = "-", digits: int = 6, start_value: int = 1,
    restart: str = "NEVER", suffix: str = "", allow_manual: bool = True,
    db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.read")),
) -> Any:
    """Example of what a format would produce (nothing is saved). A GET, so it never asks for confirmation."""
    f = numbering.Fmt(doc_type, prefix, date_part, separator, digits, start_value, restart, suffix, allow_manual)
    numbering.validate(f)
    return {"example": numbering.render(f, _date.today(), f.start_value)}


@router.put("/number-formats/{doc_type}")
@approval_gate.gated("system", "UPDATE", "NumberFormat", "system.write", id_param=None)
def update_number_format(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("system.write")),
    doc_type: str, body: NumberFormatIn,
) -> Any:
    """Change how new numbers look. Numbers already issued are never touched."""
    f = numbering.save_format(db, numbering.Fmt(doc_type, **body.model_dump()), current_user.id)
    return _format_view(f, db)
