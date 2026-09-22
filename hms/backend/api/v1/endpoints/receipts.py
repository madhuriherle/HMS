from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
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
from core.pagination import paginate
from services.sequences import generate_next_number
from datetime import date

router = APIRouter()

@router.get("/")
def read_receipts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    payment_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> Any:
    q = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status: q = q.filter(Receipt.payment_status == payment_status)
    if payment_mode: q = q.filter(Receipt.payment_mode == payment_mode)
    if receipt_type: q = q.filter(Receipt.receipt_type == receipt_type)
    if from_date: q = q.filter(Receipt.receipt_date >= from_date)
    if to_date: q = q.filter(Receipt.receipt_date <= to_date)
    return paginate(q, page, limit)

@router.post("/", response_model=schemas_receipts.Receipt)
def create_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    receipt_in: schemas_receipts.ReceiptCreate,
) -> Any:
    receipt_no = generate_next_number(db, "RECEIPT", "REC")
    return crud_receipts.receipt.create_with_items(db=db, obj_in=receipt_in, created_by=current_user.id, receipt_number=receipt_no)

@router.get("/{id}", response_model=schemas_receipts.Receipt)
def read_receipt(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_receipts.receipt.get(db, id)
    if not obj: raise HTTPException(404, "Receipt not found")
    return obj

@router.post("/{id}/allocate")
def allocate_receipt(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int, member_id: int, membership_id: Optional[int] = None, allocated_amount: float
) -> Any:
    """Map a receipt to a member and their membership."""
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt: raise HTTPException(404, "Receipt not found")
    alloc = ReceiptAllocation(
        receipt_id=id,
        member_id=member_id,
        membership_id=membership_id,
        allocated_amount=allocated_amount,
        created_by=current_user.id
    )
    db.add(alloc)
    db.commit()
    return {"message": "Receipt allocated successfully"}

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
