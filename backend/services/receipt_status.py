"""One visible status per receipt: UNASSIGNED -> ASSIGNED, or CANCELLED.

Stored on receipts.receipt_status (words, like every other status column). payment_status keeps
describing the money; deletion stays on is_deleted.

  UNASSIGNED  entered, not mapped to a member / applicant yet
  ASSIGNED    mapped to a member / applicant
  CANCELLED   spoiled or void paper receipt (sticky: mapping or approval never changes it)
"""

from typing import Iterable

from sqlalchemy.orm import Session

from models.receipts import Receipt, ReceiptAllocation

UNASSIGNED, ASSIGNED, CANCELLED = "UNASSIGNED", "ASSIGNED", "CANCELLED"
ALL = (UNASSIGNED, ASSIGNED, CANCELLED)


def is_cancelled(receipt: Receipt) -> bool:
    return receipt.receipt_status == CANCELLED or receipt.payment_status == "CANCELLED"


def compute(db: Session, receipt: Receipt) -> str:
    if is_cancelled(receipt):
        return CANCELLED
    has_alloc = (
        db.query(ReceiptAllocation.id)
        .filter(ReceiptAllocation.receipt_id == receipt.id, ReceiptAllocation.is_deleted == False)  # noqa: E712
        .first()
    )
    if not has_alloc:
        return UNASSIGNED
    return ASSIGNED


def refresh(db: Session, receipt: Receipt) -> str:
    """Recompute and store the status. Does not commit; the caller owns the transaction."""
    status = compute(db, receipt)
    if receipt.receipt_status != status:
        receipt.receipt_status = status
    return status


def refresh_for_members(db: Session, member_ids: Iterable[int]) -> None:
    """After a member's approval changes: re-derive the status of every receipt mapped to them."""
    ids = [m for m in member_ids if m]
    if not ids:
        return
    receipts = (
        db.query(Receipt)
        .join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
        .filter(ReceiptAllocation.member_id.in_(ids), ReceiptAllocation.is_deleted == False,  # noqa: E712
                Receipt.is_deleted == False)  # noqa: E712
        .distinct()
        .all()
    )
    for r in receipts:
        refresh(db, r)
