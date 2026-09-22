from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.masters import State, District, Taluk, PostalCode, MembershipType, DocumentType, ServiceType
from core.pagination import paginate
from schemas import masters as schemas_masters
from crud import masters as crud_masters

router = APIRouter()

# ─────────────── STATES ────────────────
@router.get("/states")
def read_states(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(State).filter(State.is_deleted == False), page, limit)

@router.post("/states", response_model=schemas_masters.State)
def create_state(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), state_in: schemas_masters.StateCreate) -> Any:
    return crud_masters.state.create(db=db, obj_in=state_in, created_by=current_user.id)

@router.put("/states/{id}", response_model=schemas_masters.State)
def update_state(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), id: int, state_in: schemas_masters.StateUpdate) -> Any:
    obj = crud_masters.state.get(db, id)
    if not obj: raise HTTPException(404, "State not found")
    return crud_masters.state.update(db, db_obj=obj, obj_in=state_in, updated_by=current_user.id)

@router.delete("/states/{id}", response_model=schemas_masters.State)
def delete_state(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), id: int) -> Any:
    return crud_masters.state.remove(db, id=id, deleted_by=current_user.id)

# ─────────────── DISTRICTS ────────────────
@router.get("/districts")
def read_districts(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), state_id: Optional[int] = None, page: int = 1, limit: int = 100) -> Any:
    q = db.query(District).filter(District.is_deleted == False)
    if state_id: q = q.filter(District.state_id == state_id)
    return paginate(q, page, limit)

@router.post("/districts", response_model=schemas_masters.District)
def create_district(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), district_in: schemas_masters.DistrictCreate) -> Any:
    return crud_masters.district.create(db=db, obj_in=district_in, created_by=current_user.id)

@router.put("/districts/{id}", response_model=schemas_masters.District)
def update_district(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), id: int, district_in: schemas_masters.DistrictUpdate) -> Any:
    obj = crud_masters.district.get(db, id)
    if not obj: raise HTTPException(404, "District not found")
    return crud_masters.district.update(db, db_obj=obj, obj_in=district_in, updated_by=current_user.id)

# ─────────────── TALUKS ────────────────
@router.get("/taluks")
def read_taluks(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), district_id: Optional[int] = None, page: int = 1, limit: int = 100) -> Any:
    q = db.query(Taluk).filter(Taluk.is_deleted == False)
    if district_id: q = q.filter(Taluk.district_id == district_id)
    return paginate(q, page, limit)

@router.post("/taluks", response_model=schemas_masters.Taluk)
def create_taluk(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), taluk_in: schemas_masters.TalukCreate) -> Any:
    return crud_masters.taluk.create(db=db, obj_in=taluk_in, created_by=current_user.id)

# ─────────────── POSTAL CODES ────────────────
@router.get("/postal-codes")
def read_postal_codes(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), pincode: Optional[str] = None, district_id: Optional[int] = None, page: int = 1, limit: int = 100) -> Any:
    q = db.query(PostalCode).filter(PostalCode.is_deleted == False)
    if pincode: q = q.filter(PostalCode.pincode.ilike(f"%{pincode}%"))
    if district_id: q = q.filter(PostalCode.district_id == district_id)
    return paginate(q, page, limit)

@router.post("/postal-codes", response_model=schemas_masters.PostalCode)
def create_postal_code(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), pc_in: schemas_masters.PostalCodeCreate) -> Any:
    return crud_masters.postal_code.create(db=db, obj_in=pc_in, created_by=current_user.id)

# ─────────────── MEMBERSHIP TYPES ────────────────
@router.get("/membership-types")
def read_membership_types(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(MembershipType).filter(MembershipType.is_deleted == False), page, limit)

@router.post("/membership-types", response_model=schemas_masters.MembershipType)
def create_membership_type(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), mt_in: schemas_masters.MembershipTypeCreate) -> Any:
    return crud_masters.membership_type.create(db=db, obj_in=mt_in, created_by=current_user.id)

@router.put("/membership-types/{id}", response_model=schemas_masters.MembershipType)
def update_membership_type(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), id: int, mt_in: schemas_masters.MembershipTypeUpdate) -> Any:
    obj = crud_masters.membership_type.get(db, id)
    if not obj: raise HTTPException(404, "Membership type not found")
    return crud_masters.membership_type.update(db, db_obj=obj, obj_in=mt_in, updated_by=current_user.id)

# ─────────────── DOCUMENT TYPES ────────────────
@router.get("/document-types")
def read_document_types(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(DocumentType).filter(DocumentType.is_deleted == False), page, limit)

@router.post("/document-types", response_model=schemas_masters.DocumentType)
def create_document_type(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("masters.write")), dt_in: schemas_masters.DocumentTypeCreate) -> Any:
    return crud_masters.document_type.create(db=db, obj_in=dt_in, created_by=current_user.id)

# ─────────────── SERVICE TYPES ────────────────
@router.get("/service-types")
def read_service_types(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(ServiceType).filter(ServiceType.is_deleted == False), page, limit)
