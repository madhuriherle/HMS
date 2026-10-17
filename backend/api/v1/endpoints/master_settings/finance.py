
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
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
from .common import in_use

router = APIRouter()


def _soft_delete(db: Session, item, user_id: int):
    item.is_deleted = True
    item.deleted_by = user_id
    db.commit()
    db.refresh(item)
    return item

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
    # The same bank with the same account number (blank = blank) must not be entered twice
    wanted_acct = (bank_in.account_number or "").strip().lower()
    for other in db.query(Bank).filter(Bank.is_deleted == False).all():  # noqa: E712
        if (
            (other.name_en or "").strip().lower() == bank_in.name_en.strip().lower()
            and (other.account_number or "").strip().lower() == wanted_acct
        ):
            raise HTTPException(
                409,
                f"Bank '{bank_in.name_en}'"
                + (f" with account {bank_in.account_number}" if wanted_acct else "")
                + " already exists",
            )
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
    force: bool = False,
    dry_run: bool = Query(False, include_in_schema=False),
) -> Any:
    obj = crud_masters.bank.get(db, id)
    if not obj:
        raise HTTPException(404, "Bank not found")
    live_modes = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.bank_id == id, models.masters.PaymentMode.is_deleted == False).all()  # noqa: E712
    if live_modes and not force:
        names = ', '.join(sorted({m.payment_mode for m in live_modes}))
        in_use(f"Bank is used by payment mode(s) {names}. Deleting the bank will delete those payment modes too.")
    if dry_run is True:
        return None
    for m in live_modes:
        m.is_deleted = True
        m.deleted_by = current_user.id
    db.flush()
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
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id, models.masters.PaymentMode.is_deleted == False).first()  # noqa: E712
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
    if str(item_in.payment_type or "").strip().lower() == "online" and not item_in.bank_id:
        raise HTTPException(400, "An online payment mode needs a bank")
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
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id, models.masters.PaymentMode.is_deleted == False).first()  # noqa: E712
    if not item:
        raise HTTPException(status_code=404, detail="Payment mode not found")
    data = item_in.model_dump(exclude_unset=True)
    new_name = data.get("payment_mode", item.payment_mode)
    new_bank = data.get("bank_id", item.bank_id)
    if ("payment_type" in data or "bank_id" in data) and str(data.get("payment_type", item.payment_type) or "").strip().lower() == "online" and not new_bank:
        raise HTTPException(400, "An online payment mode needs a bank")
    if ("payment_mode" in data or "bank_id" in data) and db.query(models.masters.PaymentMode).filter(
        func.lower(models.masters.PaymentMode.payment_mode) == str(new_name).strip().lower(),
        models.masters.PaymentMode.bank_id == new_bank if new_bank is not None else models.masters.PaymentMode.bank_id.is_(None),
        models.masters.PaymentMode.is_deleted == False,  # noqa: E712
        models.masters.PaymentMode.id != id,
    ).first():
        raise HTTPException(409, f"Payment mode '{new_name}' already exists")
    for k, v in data.items():
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
    force: bool = False,
    dry_run: bool = Query(False, include_in_schema=False),
    current_user: User = Depends(deps.require_permission("masters.delete")),
) -> Any:
    item = db.query(models.masters.PaymentMode).filter(models.masters.PaymentMode.id == id, models.masters.PaymentMode.is_deleted == False).first()  # noqa: E712
    if not item:
        raise HTTPException(status_code=404, detail="Payment mode not found")
    from models.receipts import Receipt
    label = item.payment_mode.strip().lower()
    used = db.query(Receipt).filter(
        Receipt.is_deleted == False,  # noqa: E712
        or_(func.lower(Receipt.payment_mode) == label, func.lower(Receipt.bank_account) == label),
    ).count()
    if used and not force:
        in_use(f"Payment mode '{item.payment_mode}' is used by {used} receipt(s). Those receipts keep their recorded mode. Deactivating it instead is safer.")
    if dry_run is True:
        return None
    return _soft_delete(db, item, current_user.id)


# ─────────────── PARTICULARS ────────────────
@router.get("/particulars")
def read_particulars(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 1000,
) -> Any:
    q = db.query(Particular).filter(Particular.is_deleted == False)
    page_data = paginate(q.order_by(Particular.id), page, limit)
    # top-level particulars follow the order saved on the Particulars screen; the rest keep id order
    from api.v1.endpoints.master_settings.extras import particular_order
    rank = {pid: i for i, pid in enumerate(particular_order(db))}
    page_data["data"].sort(key=lambda r: (rank.get(r["id"], len(rank)) if not r.get("parent_id") else len(rank) + 1, r["id"]))
    return page_data

@router.post("/particulars", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "CREATE", "Particular", "masters.write")
def create_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    obj_in: schemas_masters.ParticularCreate,
) -> Any:
    if obj_in.parent_id:  # a sub type follows its main particular: it carries neither tick
        obj_in.pays_for_membership = False
        obj_in.needs_description = False
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
    data = obj_in.model_dump(exclude_unset=True)
    if "parent_id" in data and data["parent_id"] == id:
        raise HTTPException(400, "A particular cannot be its own parent")
    if data.get("parent_id", obj.parent_id):  # a sub type carries neither tick
        if "pays_for_membership" in data:
            obj_in.pays_for_membership = False
        if "needs_description" in data:
            obj_in.needs_description = False
    for field in ("code", "name_en"):
        if field in data and data[field] != getattr(obj, field):
            dup = db.query(Particular).filter(
                getattr(Particular, field) == data[field],
                Particular.parent_id == data.get("parent_id", obj.parent_id),
                Particular.is_deleted == False,  # noqa: E712
                Particular.id != id,
            ).first()
            if dup:
                raise HTTPException(409, f"Particular {field.replace('_en', '')} '{data[field]}' already exists")
    return crud_masters.particular.update(db, db_obj=obj, obj_in=obj_in, updated_by=current_user.id)

@router.delete("/particulars/{id}", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "DELETE", "Particular", "masters.delete")
def delete_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
    force: bool = False,
    dry_run: bool = Query(False, include_in_schema=False),
) -> Any:
    obj = crud_masters.particular.get(db, id)
    if not obj:
        raise HTTPException(404, "Particular not found")
    from models.receipts import Receipt, ReceiptItem
    ids = [id] + [r[0] for r in db.query(Particular.id).filter(Particular.parent_id == id, Particular.is_deleted == False)]  # noqa: E712
    used = (
        db.query(ReceiptItem.receipt_id)
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .filter(ReceiptItem.particular_id.in_(ids), ReceiptItem.is_deleted == False, Receipt.is_deleted == False)  # noqa: E712
        .distinct().count()
    )
    if used and not force:
        in_use(f"'{obj.name_en}' is used on {used} receipt(s). Those receipts keep the particular name. Deactivating it instead is safer.")
    if dry_run is True:
        return None
    # Deleting a particular takes its sub-types with it.
    for sub in db.query(Particular).filter(Particular.parent_id == id, Particular.is_deleted == False).all():  # noqa: E712
        crud_masters.particular.remove(db, id=sub.id, deleted_by=current_user.id)
    return crud_masters.particular.remove(db, id=id, deleted_by=current_user.id)
