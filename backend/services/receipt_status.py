"""One visible status per receipt: UNASSIGNED -> ASSIGNED -> APPROVED, or CANCELLED.

Stored on receipts.receipt_status (words, like every other status column). payment_status keeps
describing the money; deletion stays on is_deleted.

  UNASSIGNED  entered, not mapped to a member yet
  ASSIGNED    mapped to a member / associate
  APPROVED    mapped to a member whose profile is approved
  CANCELLED   spoiled or void paper receipt (sticky: mapping or approval never changes it)
"""

from typing import Iterable

from sqlalchemy.orm import Session

from models.members import Member
from models.receipts import Receipt, ReceiptAllocation

UNASSIGNED, ASSIGNED, APPROVED, CANCELLED = "UNASSIGNED", "ASSIGNED", "APPROVED", "CANCELLED"
ALL = (UNASSIGNED, ASSIGNED, APPROVED, CANCELLED)


def is_cancelled(receipt: Receipt) -> bool:
    return receipt.receipt_status == CANCELLED or receipt.payment_status == "CANCELLED"


def compute(db: Session, receipt: Receipt) -> str:
    if is_cancelled(receipt):
        return CANCELLED
    allocs = (
        db.query(ReceiptAllocation)
        .filter(ReceiptAllocation.receipt_id == receipt.id, ReceiptAllocation.is_deleted == False)  # noqa: E712
        .all()
    )
    if not allocs:
        return UNASSIGNED
    member_ids = [a.member_id for a in allocs if a.member_id]
    if member_ids and db.query(Member.id).filter(
        Member.id.in_(member_ids), Member.approval_status == "APPROVED", Member.is_deleted == False  # noqa: E712
    ).first():
        return APPROVED
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
