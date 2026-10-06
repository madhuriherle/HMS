
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from models.masters import Bank, ServiceType
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate

router = APIRouter()

# ─────────────── BANKS ────────────────
@router.get("/banks")
def read_banks(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    search: Optional[str] = None,
    status: Optional[bool] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(Bank).filter(Bank.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        q = q.filter(or_(Bank.code.ilike(like), Bank.name_en.ilike(like), Bank.branch_name.ilike(like)))
    if status is not None:
        q = q.filter(Bank.status == status)
    return paginate(q.order_by(Bank.id), page, limit)


@router.get("/banks/{id}", response_model=schemas_masters.Bank)
def read_bank(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.bank.get(db, id)
    if not obj:
        raise HTTPException(404, "Bank not found")
    return obj


@router.post("/banks", response_model=Union[schemas_masters.Bank, PendingApproval], status_code=201)
@approval_gate.gated("masters", "CREATE", "Bank", "masters.write")
def create_bank(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    bank_in: schemas_masters.BankCreate,
) -> Any:
    dup = db.query(Bank).filter(
        Bank.code == bank_in.code, Bank.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Bank code '{bank_in.code}' already exists")
    return crud_masters.bank.create(db=db, obj_in=bank_in, created_by=current_user.id)


@router.put("/banks/{id}", response_model=Union[schemas_masters.Bank, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "Bank", "masters.write")
def update_bank(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    bank_in: schemas_masters.BankUpdate,
) -> Any:
    obj = crud_masters.bank.get(db, id)
    if not obj:
        raise HTTPException(404, "Bank not found")
    data = bank_in.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != obj.code:
        dup = db.query(Bank).filter(
            Bank.code == data["code"],
            Bank.is_deleted == False,  # noqa: E712
            Bank.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"Bank code '{data['code']}' already exists")
    return crud_masters.bank.update(db, db_obj=obj, obj_in=bank_in, updated_by=current_user.id)


@router.delete("/banks/{id}", response_model=Union[schemas_masters.Bank, PendingApproval])
@approval_gate.gated("masters", "DELETE", "Bank", "masters.delete")
def delete_bank(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.bank.get(db, id)
    if not obj:
        raise HTTPException(404, "Bank not found")
    return crud_masters.bank.remove(db, id=id, deleted_by=current_user.id)



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


@router.post("/service-types", response_model=Union[schemas_masters.ServiceType, PendingApproval])
@approval_gate.gated("masters", "CREATE", "ServiceType", "masters.write")
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


@router.put("/service-types/{id}", response_model=Union[schemas_masters.ServiceType, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "ServiceType", "masters.write")
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


@router.delete("/service-types/{id}", response_model=Union[schemas_masters.ServiceType, PendingApproval])
@approval_gate.gated("masters", "DELETE", "ServiceType", "masters.delete")
def delete_service_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.service_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Service type not found")
    # In-use guard: a service_type with live member opt-ins must not be
    # deleted, or the profile's service list would silently lose entries.
    from models.members import MemberServiceOptin
    in_use = db.query(MemberServiceOptin).filter(
        MemberServiceOptin.service_type_id == id,
        MemberServiceOptin.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(
            409,
            f"Service type '{obj.code}' is in use by member {in_use.member_id} "
            f"(opt-in id={in_use.id})",
        )
    return crud_masters.service_type.remove(db, id=id, deleted_by=current_user.id)
