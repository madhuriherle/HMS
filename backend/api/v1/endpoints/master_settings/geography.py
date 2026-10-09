
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
import io
import csv
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from models.masters import District, PostalCode, State, Taluk
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate
from .common import ensure_district, ensure_state, ensure_taluk, get_active

router = APIRouter()

# ─────────────── STATES ────────────────

@router.get("/states-summary")
def get_states_summary(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    states = db.query(State).filter(State.is_deleted == False).all()
    res = []
    for st in states:
        d_count = db.query(District).filter(District.state_id == st.id, District.is_deleted == False).count()
        t_count = db.query(Taluk).join(District).filter(District.state_id == st.id, Taluk.is_deleted == False, District.is_deleted == False).count()
        p_count = db.query(PostalCode).filter(PostalCode.state_id == st.id, PostalCode.is_deleted == False).count()
        res.append({
            "id": st.id,
            "name": st.name_en,
            "code": st.code,
            "status": st.status,
            "districts": d_count,
            "taluks": t_count,
            "pins": p_count
        })
    return {"data": res}


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


@router.post("/states", response_model=Union[schemas_masters.State, PendingApproval])
@approval_gate.gated("masters", "CREATE", "State", "masters.write")
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


@router.put("/states/{id}", response_model=Union[schemas_masters.State, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "State", "masters.write")
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


@router.delete("/states/{id}", response_model=Union[schemas_masters.State, PendingApproval])
@approval_gate.gated("masters", "DELETE", "State", "masters.delete")
def delete_state(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.state.get(db, id)
    if not obj:
        raise HTTPException(404, "State not found")
        
    for pc in db.query(PostalCode).filter(PostalCode.state_id == id, PostalCode.is_deleted == False).all():  # noqa: E712
        crud_masters.postal_code.remove(db, id=pc.id, deleted_by=current_user.id)
    for t in db.query(Taluk).filter(Taluk.district_id.in_(db.query(District.id).filter(District.state_id == id)), Taluk.is_deleted == False).all():  # noqa: E712
        crud_masters.taluk.remove(db, id=t.id, deleted_by=current_user.id)
    for d in db.query(District).filter(District.state_id == id, District.is_deleted == False).all():  # noqa: E712
        crud_masters.district.remove(db, id=d.id, deleted_by=current_user.id)
        
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


@router.post("/districts", response_model=Union[schemas_masters.District, PendingApproval])
@approval_gate.gated("masters", "CREATE", "District", "masters.write")
def create_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    district_in: schemas_masters.DistrictCreate,
) -> Any:
    ensure_state(db, district_in.state_id)
    dup = db.query(District).filter(
        District.state_id == district_in.state_id,
        District.name_en == district_in.name_en,
        District.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"District '{district_in.name_en}' already exists in this state")
    return crud_masters.district.create(db=db, obj_in=district_in, created_by=current_user.id)


@router.put("/districts/{id}", response_model=Union[schemas_masters.District, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "District", "masters.write")
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
        ensure_state(db, data["state_id"])
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


@router.delete("/districts/{id}", response_model=Union[schemas_masters.District, PendingApproval])
@approval_gate.gated("masters", "DELETE", "District", "masters.delete")
def delete_district(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.district.get(db, id)
    if not obj:
        raise HTTPException(404, "District not found")
        
    for pc in db.query(PostalCode).filter(PostalCode.district_id == id, PostalCode.is_deleted == False).all():  # noqa: E712
        crud_masters.postal_code.remove(db, id=pc.id, deleted_by=current_user.id)
    for t in db.query(Taluk).filter(Taluk.district_id == id, Taluk.is_deleted == False).all():  # noqa: E712
        crud_masters.taluk.remove(db, id=t.id, deleted_by=current_user.id)
        
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


@router.post("/taluks", response_model=Union[schemas_masters.Taluk, PendingApproval])
@approval_gate.gated("masters", "CREATE", "Taluk", "masters.write")
def create_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    taluk_in: schemas_masters.TalukCreate,
) -> Any:
    ensure_district(db, taluk_in.district_id)
    dup = db.query(Taluk).filter(
        Taluk.district_id == taluk_in.district_id,
        Taluk.name_en == taluk_in.name_en,
        Taluk.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Taluk '{taluk_in.name_en}' already exists in this district")
    return crud_masters.taluk.create(db=db, obj_in=taluk_in, created_by=current_user.id)


@router.put("/taluks/{id}", response_model=Union[schemas_masters.Taluk, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "Taluk", "masters.write")
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
        ensure_district(db, data["district_id"])
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


@router.delete("/taluks/{id}", response_model=Union[schemas_masters.Taluk, PendingApproval])
@approval_gate.gated("masters", "DELETE", "Taluk", "masters.delete")
def delete_taluk(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.taluk.get(db, id)
    if not obj:
        raise HTTPException(404, "Taluk not found")
        
    for pc in db.query(PostalCode).filter(PostalCode.taluk_id == id, PostalCode.is_deleted == False).all():  # noqa: E712
        crud_masters.postal_code.remove(db, id=pc.id, deleted_by=current_user.id)
        
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



@router.get("/postal-codes/export")
def export_postal_codes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    pincode: Optional[str] = None,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    search: Optional[str] = None,
) -> Any:
    q = db.query(PostalCode, State.name_en.label("state_name"), District.name_en.label("district_name"), Taluk.name_en.label("taluk_name")).\
        outerjoin(State, PostalCode.state_id == State.id).\
        outerjoin(District, PostalCode.district_id == District.id).\
        outerjoin(Taluk, PostalCode.taluk_id == Taluk.id).\
        filter(PostalCode.is_deleted == False)
    if pincode:
        q = q.filter(PostalCode.pincode.ilike(f"%{pincode}%"))
    if state_id:
        q = q.filter(PostalCode.state_id == state_id)
    if district_id:
        q = q.filter(PostalCode.district_id == district_id)
    if taluk_id:
        q = q.filter(PostalCode.taluk_id == taluk_id)
    if search:
        q = q.filter((PostalCode.post_office_name.ilike(f"%{search}%")) | (PostalCode.pincode.ilike(f"%{search}%")))
        
    records = q.all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['pin_code', 'post_office_name', 'taluk_name', 'district_name', 'state_name', 'status'])
    
    for row in records:
        pc, st_name, dist_name, tk_name = row
        status = "Active" if pc.status == "Mapped" else pc.status
        writer.writerow([pc.pincode, pc.post_office_name or "", tk_name or "", dist_name or "", st_name or "", status or "Active"])
        
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=postal_codes.csv"}
    )


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


@router.post("/postal-codes", response_model=Union[schemas_masters.PostalCode, PendingApproval])
@approval_gate.gated("masters", "CREATE", "PostalCode", "masters.write")
def create_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    pc_in: schemas_masters.PostalCodeCreate,
) -> Any:
    ensure_state(db, pc_in.state_id)
    ensure_district(db, pc_in.district_id)
    if pc_in.taluk_id:
        ensure_taluk(db, pc_in.taluk_id)
        taluk = get_active(db, Taluk, pc_in.taluk_id, "Taluk")
        if taluk.district_id != pc_in.district_id:
            raise HTTPException(400, "Taluk does not belong to the given district")
    return crud_masters.postal_code.create(db=db, obj_in=pc_in, created_by=current_user.id)


@router.put("/postal-codes/{id}", response_model=Union[schemas_masters.PostalCode, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "PostalCode", "masters.write")
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
        ensure_state(db, data["state_id"])
    if "district_id" in data:
        ensure_district(db, data["district_id"])
    if "taluk_id" in data and data["taluk_id"] is not None:
        ensure_taluk(db, data["taluk_id"])
    if "district_id" in data or "taluk_id" in data:
        district_id = data.get("district_id", obj.district_id)
        taluk_id = data.get("taluk_id", obj.taluk_id)
        if taluk_id is not None:
            taluk = get_active(db, Taluk, taluk_id, "Taluk")
            if taluk.district_id != district_id:
                raise HTTPException(400, "Taluk does not belong to the given district")
    return crud_masters.postal_code.update(db, db_obj=obj, obj_in=pc_in, updated_by=current_user.id)


@router.delete("/postal-codes/{id}", response_model=Union[schemas_masters.PostalCode, PendingApproval])
@approval_gate.gated("masters", "DELETE", "PostalCode", "masters.delete")
def delete_postal_code(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.postal_code.get(db, id)
    if not obj:
        raise HTTPException(404, "Postal code not found")
    return crud_masters.postal_code.remove(db, id=id, deleted_by=current_user.id)
