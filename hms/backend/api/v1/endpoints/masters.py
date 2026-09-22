from typing import Any, Optional
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from api import deps
from models.users import User
from models.masters import (
    State, District, Taluk, PostalCode,
    MembershipType, MembershipTypePrice, DocumentType, ServiceType,
)
from core.pagination import paginate
from schemas import masters as schemas_masters
from crud import masters as crud_masters

router = APIRouter()


# ─────────────── validation helpers ────────────────

def _get_active(db: Session, model, id_: int, label: str):
    obj = db.query(model).filter(model.id == id_, model.is_deleted == False).first()  # noqa: E712
    if not obj:
        raise HTTPException(status_code=400, detail=f"{label} with id {id_} not found")
    return obj


def _ensure_state(db: Session, state_id: int) -> State:
    return _get_active(db, State, state_id, "State")


def _ensure_district(db: Session, district_id: int) -> District:
    return _get_active(db, District, district_id, "District")


def _ensure_taluk(db: Session, taluk_id: int) -> Taluk:
    return _get_active(db, Taluk, taluk_id, "Taluk")


# ─────────────── STATES ────────────────
@router.get("/states")
def read_states(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(State).filter(State.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(State.name_en.ilike(f"%{search}%"))
    return paginate(q, page, limit)


@router.get("/states/{id}", response_model=schemas_masters.State)
def read_state(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.state.get(db, id)
    if not obj:
        raise HTTPException(404, "State not found")
    return obj


@router.post("/states", response_model=schemas_masters.State)
def create_state(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    state_in: schemas_masters.StateCreate,
) -> Any:
    dup = db.query(State).filter(
        State.name_en == state_in.name_en, State.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"State '{state_in.name_en}' already exists")
    return crud_masters.state.create(db=db, obj_in=state_in, created_by=current_user.id)


@router.put("/states/{id}", response_model=schemas_masters.State)
def update_state(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    state_in: schemas_masters.StateUpdate,
) -> Any:
    obj = crud_masters.state.get(db, id)
    if not obj:
        raise HTTPException(404, "State not found")
    data = state_in.model_dump(exclude_unset=True)
    if "name_en" in data and data["name_en"] != obj.name_en:
        dup = db.query(State).filter(
            State.name_en == data["name_en"], State.is_deleted == False, State.id != id  # noqa: E712
        ).first()
        if dup:
            raise HTTPException(409, f"State '{data['name_en']}' already exists")
    return crud_masters.state.update(db, db_obj=obj, obj_in=state_in, updated_by=current_user.id)


@router.delete("/states/{id}", response_model=schemas_masters.State)
def delete_state(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    obj = crud_masters.state.get(db, id)
    if not obj:
        raise HTTPException(404, "State not found")
    if db.query(District).filter(District.state_id == id, District.is_deleted == False).first():  # noqa: E712
        raise HTTPException(409, "State has districts; remove or reassign them first")
    return crud_masters.state.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── DISTRICTS ────────────────
@router.get("/districts")
def read_districts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    state_id: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(District).filter(District.is_deleted == False)  # noqa: E712
    if state_id:
        q = q.filter(District.state_id == state_id)
    if search:
        q = q.filter(District.name_en.ilike(f"%{search}%"))
    return paginate(q, page, limit)


@router.get("/districts/{id}", response_model=schemas_masters.District)
def read_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.district.get(db, id)
    if not obj:
        raise HTTPException(404, "District not found")
    return obj


@router.post("/districts", response_model=schemas_masters.District)
def create_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    district_in: schemas_masters.DistrictCreate,
) -> Any:
    _ensure_state(db, district_in.state_id)
    dup = db.query(District).filter(
        District.state_id == district_in.state_id,
        District.name_en == district_in.name_en,
        District.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"District '{district_in.name_en}' already exists in this state")
    return crud_masters.district.create(db=db, obj_in=district_in, created_by=current_user.id)


@router.put("/districts/{id}", response_model=schemas_masters.District)
def update_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    district_in: schemas_masters.DistrictUpdate,
) -> Any:
    obj = crud_masters.district.get(db, id)
    if not obj:
        raise HTTPException(404, "District not found")
    data = district_in.model_dump(exclude_unset=True)
    if "state_id" in data:
        _ensure_state(db, data["state_id"])
    if "name_en" in data and data["name_en"] != obj.name_en:
        state_id = data.get("state_id", obj.state_id)
        dup = db.query(District).filter(
            District.state_id == state_id,
            District.name_en == data["name_en"],
            District.is_deleted == False,  # noqa: E712
            District.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"District '{data['name_en']}' already exists in this state")
    return crud_masters.district.update(db, db_obj=obj, obj_in=district_in, updated_by=current_user.id)


@router.delete("/districts/{id}", response_model=schemas_masters.District)
def delete_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    obj = crud_masters.district.get(db, id)
    if not obj:
        raise HTTPException(404, "District not found")
    if db.query(Taluk).filter(Taluk.district_id == id, Taluk.is_deleted == False).first():  # noqa: E712
        raise HTTPException(409, "District has taluks; remove or reassign them first")
    if db.query(PostalCode).filter(PostalCode.district_id == id, PostalCode.is_deleted == False).first():  # noqa: E712
        raise HTTPException(409, "District is referenced by postal codes")
    return crud_masters.district.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── TALUKS ────────────────
@router.get("/taluks")
def read_taluks(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    district_id: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(Taluk).filter(Taluk.is_deleted == False)  # noqa: E712
    if district_id:
        q = q.filter(Taluk.district_id == district_id)
    if search:
        q = q.filter(Taluk.name_en.ilike(f"%{search}%"))
    return paginate(q, page, limit)


@router.get("/taluks/{id}", response_model=schemas_masters.Taluk)
def read_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.taluk.get(db, id)
    if not obj:
        raise HTTPException(404, "Taluk not found")
    return obj


@router.post("/taluks", response_model=schemas_masters.Taluk)
def create_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    taluk_in: schemas_masters.TalukCreate,
) -> Any:
    _ensure_district(db, taluk_in.district_id)
    dup = db.query(Taluk).filter(
        Taluk.district_id == taluk_in.district_id,
        Taluk.name_en == taluk_in.name_en,
        Taluk.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Taluk '{taluk_in.name_en}' already exists in this district")
    return crud_masters.taluk.create(db=db, obj_in=taluk_in, created_by=current_user.id)


@router.put("/taluks/{id}", response_model=schemas_masters.Taluk)
def update_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    taluk_in: schemas_masters.TalukUpdate,
) -> Any:
    obj = crud_masters.taluk.get(db, id)
    if not obj:
        raise HTTPException(404, "Taluk not found")
    data = taluk_in.model_dump(exclude_unset=True)
    if "district_id" in data:
        _ensure_district(db, data["district_id"])
    if "name_en" in data and data["name_en"] != obj.name_en:
        district_id = data.get("district_id", obj.district_id)
        dup = db.query(Taluk).filter(
            Taluk.district_id == district_id,
            Taluk.name_en == data["name_en"],
            Taluk.is_deleted == False,  # noqa: E712
            Taluk.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"Taluk '{data['name_en']}' already exists in this district")
    return crud_masters.taluk.update(db, db_obj=obj, obj_in=taluk_in, updated_by=current_user.id)


@router.delete("/taluks/{id}", response_model=schemas_masters.Taluk)
def delete_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    obj = crud_masters.taluk.get(db, id)
    if not obj:
        raise HTTPException(404, "Taluk not found")
    if db.query(PostalCode).filter(PostalCode.taluk_id == id, PostalCode.is_deleted == False).first():  # noqa: E712
        raise HTTPException(409, "Taluk is referenced by postal codes")
    return crud_masters.taluk.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── POSTAL CODES ────────────────
@router.get("/postal-codes")
def read_postal_codes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    pincode: Optional[str] = None,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(PostalCode).filter(PostalCode.is_deleted == False)  # noqa: E712
    if pincode:
        q = q.filter(PostalCode.pincode.ilike(f"%{pincode}%"))
    if state_id:
        q = q.filter(PostalCode.state_id == state_id)
    if district_id:
        q = q.filter(PostalCode.district_id == district_id)
    if taluk_id:
        q = q.filter(PostalCode.taluk_id == taluk_id)
    if search:
        q = q.filter(PostalCode.post_office_name.ilike(f"%{search}%"))
    return paginate(q, page, limit)


@router.get("/postal-codes/template")
def postal_codes_template(
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """CSV template for the bulk import (column order matters)."""
    content = "pincode,post_office_name,state_id,district_id,taluk_id\n560001,General Post Office,1,1,1\n"
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=postal_codes_template.csv"},
    )


@router.get("/postal-codes/{id}", response_model=schemas_masters.PostalCode)
def read_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.postal_code.get(db, id)
    if not obj:
        raise HTTPException(404, "Postal code not found")
    return obj


@router.post("/postal-codes", response_model=schemas_masters.PostalCode)
def create_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    pc_in: schemas_masters.PostalCodeCreate,
) -> Any:
    _ensure_state(db, pc_in.state_id)
    _ensure_district(db, pc_in.district_id)
    if pc_in.taluk_id:
        _ensure_taluk(db, pc_in.taluk_id)
        taluk = _get_active(db, Taluk, pc_in.taluk_id, "Taluk")
        if taluk.district_id != pc_in.district_id:
            raise HTTPException(400, "Taluk does not belong to the given district")
    return crud_masters.postal_code.create(db=db, obj_in=pc_in, created_by=current_user.id)


@router.put("/postal-codes/{id}", response_model=schemas_masters.PostalCode)
def update_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    pc_in: schemas_masters.PostalCodeUpdate,
) -> Any:
    obj = crud_masters.postal_code.get(db, id)
    if not obj:
        raise HTTPException(404, "Postal code not found")
    data = pc_in.model_dump(exclude_unset=True)
    if "state_id" in data:
        _ensure_state(db, data["state_id"])
    if "district_id" in data:
        _ensure_district(db, data["district_id"])
    if "taluk_id" in data and data["taluk_id"] is not None:
        _ensure_taluk(db, data["taluk_id"])
    if "district_id" in data or "taluk_id" in data:
        district_id = data.get("district_id", obj.district_id)
        taluk_id = data.get("taluk_id", obj.taluk_id)
        if taluk_id is not None:
            taluk = _get_active(db, Taluk, taluk_id, "Taluk")
            if taluk.district_id != district_id:
                raise HTTPException(400, "Taluk does not belong to the given district")
    return crud_masters.postal_code.update(db, db_obj=obj, obj_in=pc_in, updated_by=current_user.id)


@router.delete("/postal-codes/{id}", response_model=schemas_masters.PostalCode)
def delete_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    obj = crud_masters.postal_code.get(db, id)
    if not obj:
        raise HTTPException(404, "Postal code not found")
    return crud_masters.postal_code.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── MEMBERSHIP TYPES ────────────────
def _serialize_type_with_price(db: Session, mt: MembershipType) -> dict:
    from services.pricing import active_price
    price = active_price(db, mt.id)
    return {
        "id": mt.id,
        "code": mt.code,
        "name_en": mt.name_en,
        "name_kn": mt.name_kn,
        "description": mt.description,
        "status": mt.status,
        "created_at": mt.created_at,
        "current_price": float(price.amount) if price else None,
        "current_price_id": price.id if price else None,
    }


@router.get("/membership-types")
def read_membership_types(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(MembershipType).filter(MembershipType.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(MembershipType.name_en.ilike(f"%{search}%"))
    page_data = paginate(q, page, limit)
    price_by_type = {}
    if page_data["data"]:
        type_ids = [item["id"] for item in page_data["data"]]
        from services.pricing import active_price
        prices = {}
        for tid in type_ids:
            p = active_price(db, tid)
            if p:
                prices[tid] = p
        price_by_type = prices
    for item in page_data["data"]:
        p = price_by_type.get(item["id"])
        item["current_price"] = float(p.amount) if p else None
        item["current_price_id"] = p.id if p else None
    return page_data


@router.get("/membership-types/{id}", response_model=schemas_masters.MembershipTypeWithPrice)
def read_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    return _serialize_type_with_price(db, obj)


@router.post("/membership-types", response_model=schemas_masters.MembershipTypeWithPrice)
def create_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    mt_in: schemas_masters.MembershipTypeCreate,
) -> Any:
    dup = db.query(MembershipType).filter(
        MembershipType.code == mt_in.code, MembershipType.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Membership type code '{mt_in.code}' already exists")
    obj = crud_masters.membership_type.create(db=db, obj_in=mt_in, created_by=current_user.id)
    return _serialize_type_with_price(db, obj)


@router.put("/membership-types/{id}", response_model=schemas_masters.MembershipTypeWithPrice)
def update_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    mt_in: schemas_masters.MembershipTypeUpdate,
) -> Any:
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    data = mt_in.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != obj.code:
        dup = db.query(MembershipType).filter(
            MembershipType.code == data["code"],
            MembershipType.is_deleted == False,  # noqa: E712
            MembershipType.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"Membership type code '{data['code']}' already exists")
    crud_masters.membership_type.update(db, db_obj=obj, obj_in=mt_in, updated_by=current_user.id)
    return _serialize_type_with_price(db, obj)


@router.delete("/membership-types/{id}", response_model=schemas_masters.MembershipTypeWithPrice)
def delete_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    from models.members import MemberMembership
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    in_use = db.query(MemberMembership).filter(
        MemberMembership.membership_type_id == id,
        MemberMembership.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(409, "Membership type is assigned to members and cannot be deleted")
    crud_masters.membership_type.remove(db, id=id, deleted_by=current_user.id)
    return _serialize_type_with_price(db, obj)


# ─────────────── MEMBERSHIP TYPE PRICES ────────────────
@router.get("/membership-types/{id}/prices", response_model=Any)
def read_membership_type_prices(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """Full price history for a membership type, newest first."""
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    q = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).order_by(MembershipTypePrice.effective_from.desc(), MembershipTypePrice.id.desc())
    return paginate(q, page, limit)


@router.post("/membership-types/{id}/prices", response_model=schemas_masters.MembershipTypePrice)
def create_membership_type_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    price_in: schemas_masters.MembershipTypePriceCreate,
) -> Any:
    """Set a new price — closes the current open-ended price row and opens a new one.

    This preserves full price history: old rows keep their effective_from/to span,
    the new row is open-ended until the next change.
    """
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")

    effective_from = price_in.effective_from or date.today()
    if price_in.amount < 0:
        raise HTTPException(422, "Amount must be non-negative")

    def _reprice_in_place(row: MembershipTypePrice) -> MembershipTypePrice:
        """Same-day correction: reprice an existing row instead of stacking a duplicate."""
        row.amount = price_in.amount
        row.currency = price_in.currency
        row.change_reason = price_in.change_reason or row.change_reason
        row.updated_by = current_user.id
        db.commit()
        db.refresh(row)
        return row

    # Exact-start match: a row already begins on this date → correct it in place.
    same_start = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_from == effective_from,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if same_start:
        return _reprice_in_place(same_start)

    # Date falls inside a closed row's span → that row is the active price on
    # that day (happens when a future-dated row already superseded it).
    span_row = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_from <= effective_from,
        MembershipTypePrice.effective_to >= effective_from,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if span_row:
        return _reprice_in_place(span_row)

    # Genuine new version: close the currently open-ended row(s) the day before.
    open_rows = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_to == None,  # noqa: E711
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).all()
    for row in open_rows:
        if row.effective_from > effective_from:
            raise HTTPException(
                400,
                f"Existing price (id={row.id}) starts on {row.effective_from}; "
                "new price must take effect on or after that date",
            )
        row.effective_to = effective_from - timedelta(days=1)

    new_price = MembershipTypePrice(
        membership_type_id=id,
        amount=price_in.amount,
        currency=price_in.currency,
        effective_from=effective_from,
        effective_to=None,
        change_reason=price_in.change_reason,
        created_by=current_user.id,
    )
    db.add(new_price)
    db.commit()
    db.refresh(new_price)
    return new_price


@router.get("/membership-types/{id}/prices/current", response_model=schemas_masters.MembershipTypePrice)
def read_membership_type_current_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """The price currently in effect (open-ended row, or most recent)."""
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    from services.pricing import active_price
    price = active_price(db, id)
    if not price:
        raise HTTPException(404, "No price configured for this membership type")
    return price


@router.put("/membership-types/{id}/prices/{price_id}", response_model=schemas_masters.MembershipTypePrice)
def update_membership_type_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    price_id: int,
    price_in: schemas_masters.MembershipTypePriceUpdate,
) -> Any:
    """Correct a price row (e.g. typo in amount or extend effective_to)."""
    price = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.id == price_id,
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if not price:
        raise HTTPException(404, "Price row not found for this membership type")
    data = price_in.model_dump(exclude_unset=True)
    if "amount" in data and data["amount"] is not None and data["amount"] < 0:
        raise HTTPException(422, "Amount must be non-negative")
    return crud_masters.membership_type_price.update(
        db, db_obj=price, obj_in=price_in, updated_by=current_user.id
    )


# ─────────────── DOCUMENT TYPES ────────────────
@router.get("/document-types")
def read_document_types(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 100,
) -> Any:
    return paginate(
        db.query(DocumentType).filter(DocumentType.is_deleted == False),  # noqa: E712
        page, limit,
    )


@router.post("/document-types", response_model=schemas_masters.DocumentType)
def create_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    dt_in: schemas_masters.DocumentTypeCreate,
) -> Any:
    dup = db.query(DocumentType).filter(
        DocumentType.code == dt_in.code, DocumentType.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Document type code '{dt_in.code}' already exists")
    return crud_masters.document_type.create(db=db, obj_in=dt_in, created_by=current_user.id)


@router.put("/document-types/{id}", response_model=schemas_masters.DocumentType)
def update_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    dt_in: schemas_masters.DocumentTypeUpdate,
) -> Any:
    obj = crud_masters.document_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Document type not found")
    return crud_masters.document_type.update(db, db_obj=obj, obj_in=dt_in, updated_by=current_user.id)


@router.delete("/document-types/{id}", response_model=schemas_masters.DocumentType)
def delete_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    from models.members import MemberDocument
    obj = crud_masters.document_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Document type not found")
    in_use = db.query(MemberDocument).filter(
        MemberDocument.document_type_id == id,
        MemberDocument.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(409, "Document type is used by member documents and cannot be deleted")
    return crud_masters.document_type.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── SERVICE TYPES ────────────────
@router.get("/service-types")
def read_service_types(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 100,
) -> Any:
    return paginate(
        db.query(ServiceType).filter(ServiceType.is_deleted == False),  # noqa: E712
        page, limit,
    )


@router.get("/service-types/{id}", response_model=schemas_masters.ServiceType)
def read_service_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.service_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Service type not found")
    return obj


@router.post("/service-types", response_model=schemas_masters.ServiceType)
def create_service_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    st_in: schemas_masters.ServiceTypeCreate,
) -> Any:
    dup = db.query(ServiceType).filter(
        ServiceType.code == st_in.code, ServiceType.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Service type code '{st_in.code}' already exists")
    return crud_masters.service_type.create(db=db, obj_in=st_in, created_by=current_user.id)


@router.put("/service-types/{id}", response_model=schemas_masters.ServiceType)
def update_service_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    st_in: schemas_masters.ServiceTypeUpdate,
) -> Any:
    obj = crud_masters.service_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Service type not found")
    return crud_masters.service_type.update(db, db_obj=obj, obj_in=st_in, updated_by=current_user.id)


@router.delete("/service-types/{id}", response_model=schemas_masters.ServiceType)
def delete_service_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
) -> Any:
    obj = crud_masters.service_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Service type not found")
    return crud_masters.service_type.remove(db, id=id, deleted_by=current_user.id)
