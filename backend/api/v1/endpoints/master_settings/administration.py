
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from models.masters import DeletionReason
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate

router = APIRouter()

@router.get("/deletion-reasons/{id}", response_model=schemas_masters.DeletionReason)
def read_deletion_reason(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = db.query(DeletionReason).filter(DeletionReason.id == id, DeletionReason.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Deletion reason not found")
    return obj


# ─────────────── DELETION REASONS (Mangalya parity: delete_reason) ────────────────
@router.get("/deletion-reasons")
def read_deletion_reasons(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    applies_to: Optional[str] = None,
    status: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    """Deletion-reason master. ``applies_to=SOFT|PERMANENT`` narrows to reasons
    flagged for that deletion type (reasons without a flag always match)."""
    from models.masters import DeletionReason
    q = db.query(DeletionReason).filter(DeletionReason.is_deleted == False)  # noqa: E712
    if applies_to:
        if applies_to not in ("SOFT", "PERMANENT"):
            raise HTTPException(400, "applies_to must be SOFT or PERMANENT")
        q = q.filter(or_(DeletionReason.applies_to == applies_to, DeletionReason.applies_to.is_(None)))
    if status is not None:
        q = q.filter(DeletionReason.status == status)
    if search:
        q = q.filter(DeletionReason.name_en.ilike(f"%{search}%"))
    return paginate(q.order_by(DeletionReason.id), page, limit)


@router.post("/deletion-reasons", response_model=Union[schemas_masters.DeletionReason, PendingApproval], status_code=201)
@approval_gate.gated("masters", "CREATE", "DeletionReason", "masters.write")
def create_deletion_reason(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    obj_in: schemas_masters.DeletionReasonCreate,
) -> Any:
    from models.masters import DeletionReason
    if obj_in.applies_to and obj_in.applies_to not in ("SOFT", "PERMANENT"):
        raise HTTPException(422, "applies_to must be SOFT or PERMANENT")
    dup = db.query(DeletionReason).filter(
        DeletionReason.name_en == obj_in.name_en,
        DeletionReason.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Deletion reason '{obj_in.name_en}' already exists")
    return crud_masters.deletion_reason.create(db=db, obj_in=obj_in, created_by=current_user.id)


@router.put("/deletion-reasons/{id}", response_model=Union[schemas_masters.DeletionReason, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "DeletionReason", "masters.write")
def update_deletion_reason(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    obj_in: schemas_masters.DeletionReasonUpdate,
) -> Any:
    from models.masters import DeletionReason
    obj = crud_masters.deletion_reason.get(db, id)
    if not obj:
        raise HTTPException(404, "Deletion reason not found")
    data = obj_in.model_dump(exclude_unset=True)
    if data.get("applies_to") and data["applies_to"] not in ("SOFT", "PERMANENT"):
        raise HTTPException(422, "applies_to must be SOFT or PERMANENT")
    if "name_en" in data and data["name_en"] != obj.name_en:
        dup = db.query(DeletionReason).filter(
            DeletionReason.name_en == data["name_en"],
            DeletionReason.is_deleted == False,  # noqa: E712
            DeletionReason.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"Deletion reason '{data['name_en']}' already exists")
    return crud_masters.deletion_reason.update(db, db_obj=obj, obj_in=obj_in, updated_by=current_user.id)


@router.delete("/deletion-reasons/{id}", response_model=Union[schemas_masters.DeletionReason, PendingApproval])
@approval_gate.gated("masters", "DELETE", "DeletionReason", "masters.delete")
def delete_deletion_reason(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    from models.members import MemberDeletionRequest
    from models.masters import DeletionReason
    obj = crud_masters.deletion_reason.get(db, id)
    if not obj:
        raise HTTPException(404, "Deletion reason not found")
    in_use = db.query(MemberDeletionRequest).filter(
        MemberDeletionRequest.reason_id == id,
        MemberDeletionRequest.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(409, "Deletion reason is used by deletion requests and cannot be deleted")
    return crud_masters.deletion_reason.remove(db, id=id, deleted_by=current_user.id)
