
from fastapi import HTTPException

from core.exceptions import InUseError
from sqlalchemy.orm import Session

from sqlalchemy import or_

from models.members import Member
from models.masters import District, PostalCode, State, Taluk


def get_active(db: Session, model, id_: int, label: str):
    obj = db.query(model).filter(model.id == id_, model.is_deleted == False).first()  # noqa: E712
    if not obj:
        raise HTTPException(status_code=400, detail=f"{label} with id {id_} not found")
    return obj


def ensure_state(db: Session, state_id: int) -> State:
    return get_active(db, State, state_id, "State")


def ensure_district(db: Session, district_id: int) -> District:
    return get_active(db, District, district_id, "District")


def ensure_taluk(db: Session, taluk_id: int) -> Taluk:
    return get_active(db, Taluk, taluk_id, "Taluk")


def in_use(message: str, *, can_force: bool = True):
    """409 the app turns into an "are you sure?" warning; can_force=False means a hard stop."""
    raise InUseError(message, can_force)


def ensure_not_used_by_members(db: Session, label: str, *, state_ids=(), district_ids=(), taluk_ids=(), pincode_ids=(), force: bool = False):
    """Members keep location ids with no database foreign key, so block the delete here."""
    conds = []
    if state_ids:
        conds.append(Member.state_id.in_(list(state_ids)))
    if district_ids:
        conds.append(Member.district_id.in_(list(district_ids)))
    if taluk_ids:
        conds.append(Member.taluk_id.in_(list(taluk_ids)))
    if pincode_ids:
        conds.append(Member.pincode_id.in_(list(pincode_ids)))
    if not conds:
        return
    n = db.query(Member).filter(Member.is_deleted == False, or_(*conds)).count()  # noqa: E712
    if n and not force:
        in_use(f"{label} is used by {n} member(s). Those members keep the saved location, but it will no longer be selectable.")


def district_ids_of_state(db: Session, state_id: int):
    return [r[0] for r in db.query(District.id).filter(District.state_id == state_id, District.is_deleted == False)]  # noqa: E712


def taluk_ids_of_districts(db: Session, district_ids):
    if not district_ids:
        return []
    return [r[0] for r in db.query(Taluk.id).filter(Taluk.district_id.in_(list(district_ids)), Taluk.is_deleted == False)]  # noqa: E712
