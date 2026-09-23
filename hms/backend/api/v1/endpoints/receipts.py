from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.members import Member, MemberMembership
from models.users import User
from models.receipts import (
    PaymentTransaction,
    Receipt,
    ReceiptAllocation,
    ReceiptCancellation,
    RefundTransaction,
)
from schemas import receipts as schemas_receipts
from crud import receipts as crud_receipts
from crud.receipts import allocated_total
from core.pagination import paginate
from services.sequences import generate_next_number
from datetime import date

router = APIRouter()

VALID_RECEIPT_TYPES = {"MEMBERSHIP", "DONATION", "MAGAZINE", "EVENT", "OTHER"}
VALID_PAYMENT_MODES = {"CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "OTHER"}


def _validate_enum(value: str, allowed: set, field: str) -> None:
    if value not in allowed:
        raise HTTPException(400, f"{field} must be one of {sorted(allowed)}")


def _get_member_or_404(db: Session, member_id: int) -> Member:
    member = db.query(Member).filter(
        Member.id == member_id, Member.is_deleted == False
    ).first()
    if not member:
        raise HTTPException(400, f"Member {member_id} not found")
    return member


def _validate_membership(db: Session, member_id: int, membership_id: Optional[int]) -> None:
    if membership_id is None:
        return
    link = db.query(MemberMembership).filter(
        MemberMembership.id == membership_id,
        MemberMembership.member_id == member_id,
        MemberMembership.is_deleted == False,
    ).first()
    if not link:
        raise HTTPException(
            400, f"membership_id {membership_id} does not belong to member {member_id}"
        )


def _validate_allocation_amount(
    db: Session,
    receipt: Receipt,
    *,
    allocated_amount: float,
    exclude_allocation_id: Optional[int] = None,
) -> None:
    """An allocation cannot push the receipt's total allocation past its net amount."""
    if allocated_amount > float(receipt.net_amount):
        raise HTTPException(
            400,
            f"allocated_amount {allocated_amount} exceeds receipt net_amount {float(receipt.net_amount)}",
        )
    total = allocated_total(db, receipt.id)
    if exclude_allocation_id:
        existing = db.query(ReceiptAllocation).filter(
            ReceiptAllocation.id == exclude_allocation_id, ReceiptAllocation.is_deleted == False
        ).first()
        if existing:
            total -= float(existing.allocated_amount)
    if total + allocated_amount > float(receipt.net_amount) + 0.01:
        raise HTTPException(
            409,
            (
                f"Over-allocation: {total + allocated_amount} would exceed the "
                f"receipt net_amount {float(receipt.net_amount)} "
                f"(already allocated: {total})"
            ),
        )


@router.get("/")
def read_receipts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    payment_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    source: Optional[str] = None,
    member_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> Any:
    """Receipt entries with filters; source=ONLINE|OFFLINE, member_id narrows
    to receipts mapped to that member."""
    q = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status: q = q.filter(Receipt.payment_status == payment_status)
    if payment_mode: q = q.filter(Receipt.payment_mode == payment_mode)
    if receipt_type: q = q.filter(Receipt.receipt_type == receipt_type)
    if source:
        if source not in ("ONLINE", "OFFLINE"):
            raise HTTPException(400, "source must be ONLINE or OFFLINE")
        q = q.filter(Receipt.source == source)
    if member_id:
        q = q.join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(
            ReceiptAllocation.member_id == member_id,
            ReceiptAllocation.is_deleted == False,
        ).distinct()
    if from_date: q = q.filter(Receipt.receipt_date >= from_date)
    if to_date: q = q.filter(Receipt.receipt_date <= to_date)
    return paginate(q.order_by(Receipt.id.desc()), page, limit)


@router.post("/", response_model=schemas_receipts.Receipt, status_code=201)
def create_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    receipt_in: schemas_receipts.ReceiptCreate,
) -> Any:
    """Receipt entry for ONLINE (website/app) and OFFLINE (counter) registrations.

    Optionally maps the receipt to members in the same call via ``allocations``
    — once allocated, the member enters the magazine label print list.
    """
    _validate_enum(receipt_in.receipt_type, VALID_RECEIPT_TYPES, "receipt_type")
    _validate_enum(receipt_in.payment_mode, VALID_PAYMENT_MODES, "payment_mode")

    # Pre-validate member mappings so the whole entry fails before anything is written.
    inline_total = 0.0
    for alloc in receipt_in.allocations:
        _get_member_or_404(db, alloc.member_id)
        _validate_membership(db, alloc.member_id, alloc.membership_id)
        inline_total += alloc.allocated_amount
    if inline_total > receipt_in.net_amount + 0.01:
        raise HTTPException(
            409,
            f"Over-allocation: inline allocations total {inline_total} exceeds "
            f"receipt net_amount {receipt_in.net_amount}",
        )

    receipt_no = generate_next_number(db, "RECEIPT", "REC")
    return crud_receipts.receipt.create_with_items(
        db=db, obj_in=receipt_in, created_by=current_user.id, receipt_number=receipt_no
    )


@router.get("/allocations")
def read_allocations(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    receipt_id: Optional[int] = None,
    member_id: Optional[int] = None,
) -> Any:
    """Member mappings of receipts (who received which receipt)."""
    q = db.query(ReceiptAllocation).filter(ReceiptAllocation.is_deleted == False)
    if receipt_id: q = q.filter(ReceiptAllocation.receipt_id == receipt_id)
    if member_id: q = q.filter(ReceiptAllocation.member_id == member_id)
    q = q.order_by(ReceiptAllocation.id.desc())
    page_data = paginate(q, page, limit)

    member_ids = {a["member_id"] for a in page_data["data"] if a.get("member_id")}
    names = {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)
    for a in page_data["data"]:
        a["member_name"] = names.get(a.get("member_id"))
    return page_data


@router.get("/{id}", response_model=schemas_receipts.Receipt)
def read_receipt(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_receipts.receipt.get(db, id)
    if not obj: raise HTTPException(404, "Receipt not found")
    return obj


@router.put("/{id}", response_model=schemas_receipts.Receipt)
def update_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    receipt_in: schemas_receipts.ReceiptUpdate,
) -> Any:
    """Manage a receipt entry (correct payer, amounts, mode, notes).

    Amount edits must keep the totals consistent and cannot fall below what
    has already been allocated to members.
    """
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Cancelled receipts cannot be edited")

    data = receipt_in.model_dump(exclude_unset=True)
    gross = data.get("gross_amount", float(receipt.gross_amount))
    discount = data.get("discount_amount", float(receipt.discount_amount))
    net = data.get("net_amount", float(receipt.net_amount))
    if abs(net - (gross - discount)) > 0.01:
        raise HTTPException(400, "net_amount must equal gross_amount - discount_amount")
    if "source" in data and data["source"]:
        _validate_enum(data["source"], {"ONLINE", "OFFLINE"}, "source")
    if "receipt_type" in data and data["receipt_type"]:
        _validate_enum(data["receipt_type"], VALID_RECEIPT_TYPES, "receipt_type")
    if "payment_mode" in data and data["payment_mode"]:
        _validate_enum(data["payment_mode"], VALID_PAYMENT_MODES, "payment_mode")

    net = data.get("net_amount", float(receipt.net_amount))
    allocated = allocated_total(db, receipt.id)
    if net < allocated - 0.01:
        raise HTTPException(
            409,
            f"net_amount {net} is below the already-allocated total {allocated}; "
            f"remove allocations first",
        )
    return crud_receipts.receipt.update(db, db_obj=receipt, obj_in=data, updated_by=current_user.id)


@router.delete("/{id}", response_model=schemas_receipts.Receipt)
def delete_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if allocated_total(db, receipt.id) > 0:
        raise HTTPException(
            409, "Receipt has member allocations; remove them before deleting"
        )
    return crud_receipts.receipt.remove(db, id=id, deleted_by=current_user.id)


@router.post("/{id}/allocate", response_model=schemas_receipts.ReceiptAllocation, status_code=201)
def allocate_receipt(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.ReceiptAllocationCreate,
) -> Any:
    """Map a created receipt to a member (and optionally their membership).

    Once mapped, the member enters the magazine label print list (generate
    labels with only_paid=true).
    """
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Cannot allocate a cancelled receipt")

    _get_member_or_404(db, payload.member_id)
    _validate_membership(db, payload.member_id, payload.membership_id)
    _validate_allocation_amount(
        db, receipt, allocated_amount=payload.allocated_amount
    )

    alloc = ReceiptAllocation(
        receipt_id=id,
        member_id=payload.member_id,
        membership_id=payload.membership_id,
        allocated_amount=payload.allocated_amount,
        created_by=current_user.id,
    )
    db.add(alloc)
    db.commit()
    db.refresh(alloc)
    return alloc


@router.get("/{id}/allocations", response_model=list[schemas_receipts.ReceiptAllocationWithMember])
def read_receipt_allocations(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """The member mappings of one receipt."""
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    allocs = (
        db.query(ReceiptAllocation)
        .filter(
            ReceiptAllocation.receipt_id == id,
            ReceiptAllocation.is_deleted == False,
        )
        .order_by(ReceiptAllocation.id)
        .all()
    )
    member_ids = {a.member_id for a in allocs if a.member_id}
    names = {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)
    result = []
    for a in allocs:
        item = schemas_receipts.ReceiptAllocationWithMember.model_validate(a)
        item.member_name = names.get(a.member_id)
        result.append(item)
    return result


@router.delete("/{id}/allocations/{allocation_id}", response_model=schemas_receipts.ReceiptAllocation)
def remove_allocation(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    allocation_id: int,
) -> Any:
    """Un-map a receipt from a member (e.g. assigned to the wrong member)."""
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    alloc = db.query(ReceiptAllocation).filter(
        ReceiptAllocation.id == allocation_id,
        ReceiptAllocation.receipt_id == id,
        ReceiptAllocation.is_deleted == False,
    ).first()
    if not alloc:
        raise HTTPException(404, "Allocation not found")
    alloc.is_deleted = True
    alloc.deleted_by = current_user.id
    db.commit()
    db.refresh(alloc)
    return alloc


@router.post("/{id}/cancel")
def cancel_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.ReceiptCancellationCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Receipt is already cancelled")

    receipt.payment_status = "CANCELLED"
    receipt.updated_by = current_user.id
    cancellation = ReceiptCancellation(
        receipt_id=id,
        cancelled_by=current_user.id,
        reason=payload.reason,
        created_by=current_user.id,
    )
    db.add(cancellation)
    db.commit()
    return {"message": "Receipt cancelled successfully"}


@router.post("/{id}/refund", response_model=schemas_receipts.RefundTransaction)
def create_refund(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.RefundTransactionCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    refund = RefundTransaction(
        receipt_id=id,
        amount=payload.amount,
        status=payload.status,
        refund_reference=payload.refund_reference,
        created_by=current_user.id,
    )
    db.add(refund)
    db.commit()
    db.refresh(refund)
    return refund


@router.post("/{id}/payment-transactions", response_model=schemas_receipts.PaymentTransaction)
def create_payment_transaction(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.PaymentTransactionCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    transaction = PaymentTransaction(
        receipt_id=id,
        gateway_reference=payload.gateway_reference,
        status=payload.status,
        amount=payload.amount,
        created_by=current_user.id,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction
