
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.masters import District, State, Taluk


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
