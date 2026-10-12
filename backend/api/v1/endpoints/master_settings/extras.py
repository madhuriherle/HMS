"""Master helpers: where an item is used, recently deleted (restore) and particular ordering."""

from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from api import deps
from models.masters import Bank, DocumentType, HmsSetting, MembershipType, Particular, PaymentMode, ServiceType
from models.members import MemberMembership
from models.receipts import ReceiptItem
from models.users import User

router = APIRouter()

# kind -> (model, name column, code column)
KINDS = {
    "particulars": (Particular, "name_en", "code"),
    "banks": (Bank, "name_en", "code"),
    "membership-types": (MembershipType, "name_en", "code"),
    "document-types": (DocumentType, "name_en", "code"),
    "service-types": (ServiceType, "name_en", "code"),
}
ORDER_KEY = "particulars.order"


def _kind(kind: str):
    if kind not in KINDS:
        raise HTTPException(404, f"Unknown master '{kind}'")
    return KINDS[kind]


def particular_order(db: Session) -> List[int]:
    row = db.query(HmsSetting).filter(HmsSetting.setting_key == ORDER_KEY, HmsSetting.is_deleted == False).first()  # noqa: E712
    return list((row.setting_value or {}).get("ids", [])) if row else []


@router.get("/usage/{kind}")
def master_usage(
    kind: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """How many live records use each item, so the screens can say why a delete is blocked."""
    _kind(kind)
    counts: dict = {}
    if kind == "particulars":
        for pid, n in (
            db.query(ReceiptItem.particular_id, func.count())
            .filter(ReceiptItem.particular_id.isnot(None), ReceiptItem.is_deleted == False)  # noqa: E712
            .group_by(ReceiptItem.particular_id)
        ):
            counts[pid] = {"used": n}
        for pid, n in (
            db.query(Particular.parent_id, func.count())
            .filter(Particular.parent_id.isnot(None), Particular.is_deleted == False)  # noqa: E712
            .group_by(Particular.parent_id)
        ):
            counts.setdefault(pid, {"used": 0})["children"] = n
    elif kind == "membership-types":
        for tid, n in (
            db.query(MemberMembership.membership_type_id, func.count())
            .filter(MemberMembership.is_deleted == False)  # noqa: E712
            .group_by(MemberMembership.membership_type_id)
        ):
            counts[tid] = {"used": n}
    elif kind == "banks":
        for bid, n in (
            db.query(PaymentMode.bank_id, func.count())
            .filter(PaymentMode.bank_id.isnot(None))
            .group_by(PaymentMode.bank_id)
        ):
            counts[bid] = {"used": n}
    return {"kind": kind, "counts": counts}


@router.get("/deleted/{kind}")
def recently_deleted(
    kind: str,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
) -> Any:
    model, name_col, code_col = _kind(kind)
    rows = (
        db.query(model)
        .filter(model.is_deleted == True)  # noqa: E712
        .order_by(model.deleted_at.desc().nullslast(), model.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return {
        "kind": kind,
        "data": [
            {"id": r.id, "name": getattr(r, name_col), "code": getattr(r, code_col, None),
             "deleted_at": r.deleted_at, "parent_id": getattr(r, "parent_id", None)}
            for r in rows
        ],
    }


@router.post("/deleted/{kind}/{id}/restore")
def restore_deleted(
    kind: str,
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
) -> Any:
    """Bring a deleted master item back. Refused if a live item has taken its code since."""
    model, name_col, code_col = _kind(kind)
    row = db.query(model).filter(model.id == id, model.is_deleted == True).first()  # noqa: E712
    if not row:
        raise HTTPException(404, "Deleted item not found")
    code = getattr(row, code_col, None)
    if code and db.query(model.id).filter(
        getattr(model, code_col) == code, model.is_deleted == False, model.id != id  # noqa: E712
    ).first():
        raise HTTPException(409, f'Cannot restore: "{code}" is now used by another item. Rename or delete that one first.')
    parent_id = getattr(row, "parent_id", None)
    if parent_id and db.query(model.id).filter(model.id == parent_id, model.is_deleted == True).first():  # noqa: E712
        raise HTTPException(409, "Restore its parent particular first.")
    row.is_deleted = False
    row.deleted_at = None
    row.deleted_by = None
    row.updated_by = current_user.id
    db.commit()
    return {"id": row.id, "name": getattr(row, name_col), "restored": True}


class ParticularOrder(BaseModel):
    ids: List[int]


@router.get("/particulars-order")
def read_particulars_order(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    return {"ids": particular_order(db)}


@router.put("/particulars-order")
def save_particulars_order(
    body: ParticularOrder,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
) -> Any:
    """Order of the top-level particulars in the Receipt Entry dropdown and the Particulars screen."""
    known = {i for (i,) in db.query(Particular.id).filter(Particular.is_deleted == False, Particular.parent_id.is_(None))}  # noqa: E712
    ids = [i for i in dict.fromkeys(body.ids) if i in known]
    row = db.query(HmsSetting).filter(HmsSetting.setting_key == ORDER_KEY).first()
    if row:
        row.setting_value = {"ids": ids}
        row.is_deleted = False
        row.updated_by = current_user.id
    else:
        db.add(HmsSetting(
            setting_key=ORDER_KEY, setting_value={"ids": ids}, data_type="json",
            description="Display order of top-level particulars", created_by=current_user.id,
        ))
    db.commit()
    return {"ids": ids}
