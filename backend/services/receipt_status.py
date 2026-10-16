"""One visible status per receipt: UNASSIGNED -> ASSIGNED, or CANCELLED.

Stored on receipts.receipt_status (words, like every other status column). payment_status keeps
describing the money; deletion stays on is_deleted.

  UNASSIGNED  entered, not mapped to a member / applicant yet
  ASSIGNED    mapped to a member / applicant
  CANCELLED   spoiled or void paper receipt (sticky: mapping or approval never changes it)
"""

from typing import Iterable, Optional

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


def unassign_member_receipts(db: Session, member_id: int, deleted_by: Optional[int] = None, at=None) -> list:
    """A member is being deleted: their receipts go back to UNASSIGNED so they can be mapped to someone else (the money
    and the receipts stay). Returns the receipt numbers that were un-mapped. Does not commit. ``at`` is the moment the
    member is deleted: it is stamped on each un-mapped link, so restoring the member from the Recycle Bin can tell
    these links from ones someone un-mapped by hand."""
    receipts = (
        db.query(Receipt)
        .join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
        .filter(ReceiptAllocation.member_id == member_id, ReceiptAllocation.is_deleted == False,  # noqa: E712
                Receipt.is_deleted == False)  # noqa: E712
        .distinct()
        .all()
    )
    db.query(ReceiptAllocation).filter(
        ReceiptAllocation.member_id == member_id, ReceiptAllocation.is_deleted == False  # noqa: E712
    ).update({"is_deleted": True, "deleted_by": deleted_by, "deleted_at": at}, synchronize_session=False)
    db.flush()
    for r in receipts:
        db.refresh(r)
        refresh(db, r)
    return [r.receipt_number for r in receipts]


def relink_member_receipts(db: Session, member_id: int, deleted_at, acted_by: Optional[int] = None) -> list:
    """A deleted member is restored: the receipts that went back to Unassigned *because of that deletion* are linked to
    them again. A receipt that was meanwhile mapped to someone else, cancelled or deleted is left alone, and so is a link
    someone removed by hand (it carries a different time). Returns the receipt numbers. Does not commit."""
    if deleted_at is None:
        return []
    links = (
        db.query(ReceiptAllocation)
        .filter(ReceiptAllocation.member_id == member_id, ReceiptAllocation.is_deleted == True,  # noqa: E712
                ReceiptAllocation.deleted_at == deleted_at)
        .all()
    )
    numbers = []
    for link in links:
        receipt = db.get(Receipt, link.receipt_id)
        if receipt is None or receipt.is_deleted or is_cancelled(receipt) or compute(db, receipt) != UNASSIGNED:
            continue
        link.is_deleted = False
        link.deleted_at = None
        link.deleted_by = None
        db.flush()
        refresh(db, receipt)
        numbers.append(receipt.receipt_number)
    return numbers


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
