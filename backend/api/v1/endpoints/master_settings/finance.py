
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
import models.masters
from models.masters import Bank, ServiceType, Particular
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

# ─── PAYMENT MODES ───
@router.get("/payment-modes")
def read_payment_modes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 100,
    status: Optional[bool] = None
) -> Any:
    q = db.query(models.masters.PaymentMode).filter(
        models.masters.PaymentMode.is_deleted == False  # noqa: E712
    )
    if status is not None:
        q = q.filter(models.masters.PaymentMode.status == status)
    return paginate(q.order_by(models.masters.PaymentMode.id), page, limit)

@router.get("/payment-modes/{id}", response_model=schemas_masters.PaymentMode)
def read_payment_mode(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Payment mode not found")
    return item

@router.post("/payment-modes", response_model=Union[schemas_masters.PaymentMode, PendingApproval], status_code=201)
@approval_gate.gated("masters", "CREATE", "PaymentMode", "masters.write")
def create_payment_mode(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    item_in: schemas_masters.PaymentModeCreate,
) -> Any:
    item = models.masters.PaymentMode(**item_in.model_dump())
    item.created_by = current_user.id
    item.updated_by = current_user.id
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@router.put("/payment-modes/{id}", response_model=Union[schemas_masters.PaymentMode, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "PaymentMode", "masters.write")
def update_payment_mode(
    *,
    db: Session = Depends(deps.get_db),
    id: int,
    item_in: schemas_masters.PaymentModeUpdate,
    current_user: User = Depends(deps.require_permission("masters.write")),
) -> Any:
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Payment mode not found")
    for k, v in item_in.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    item.updated_by = current_user.id
    db.commit()
    db.refresh(item)
    return item

@router.delete("/payment-modes/{id}", response_model=Union[schemas_masters.PaymentMode, PendingApproval])
@approval_gate.gated("masters", "DELETE", "PaymentMode", "masters.delete")
def delete_payment_mode(
    *,
    db: Session = Depends(deps.get_db),
    id: int,
    current_user: User = Depends(deps.require_permission("masters.delete")),
) -> Any:
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Payment mode not found")
    db.delete(item)
    db.commit()
    return item


# ─────────────── PARTICULARS ────────────────
@router.get("/particulars")
def read_particulars(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 1000,
) -> Any:
    q = db.query(Particular).filter(Particular.is_deleted == False)
    return paginate(q, page, limit)

@router.post("/particulars", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "CREATE", "Particular", "masters.write")
def create_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    obj_in: schemas_masters.ParticularCreate,
) -> Any:
    return crud_masters.particular.create(db=db, obj_in=obj_in, created_by=current_user.id)

@router.put("/particulars/{id}", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "Particular", "masters.write")
def update_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    obj_in: schemas_masters.ParticularUpdate,
) -> Any:
    obj = crud_masters.particular.get(db, id)
    if not obj:
        raise HTTPException(404, "Particular not found")
    return crud_masters.particular.update(db, db_obj=obj, obj_in=obj_in, updated_by=current_user.id)

@router.delete("/particulars/{id}", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "DELETE", "Particular", "masters.delete")
def delete_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.particular.get(db, id)
    if not obj:
        raise HTTPException(404, "Particular not found")
    return crud_masters.particular.remove(db, id=id, deleted_by=current_user.id)
