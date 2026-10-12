from typing import Optional
from crud.base import CRUDBase
from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
from schemas.receipts import ReceiptCreate, ReceiptUpdate
from sqlalchemy.orm import Session


class CRUDReceipt(CRUDBase[Receipt, ReceiptCreate, ReceiptUpdate]):
    def create_with_items(
        self,
        db: Session,
        *,
        obj_in: ReceiptCreate,
        created_by: Optional[int] = None,
        receipt_number: str,
    ) -> Receipt:
        """Create the receipt with its items and member allocations in one commit.

        ``obj_in.allocations`` maps the receipt to members in the same
        transaction as the entry; member ids are validated by the endpoint
        before reaching here.
        """
        # receipt_number is minted by the endpoint and passed explicitly;
        # drop any client-supplied value so it can't collide as a duplicate kwarg.
        receipt_data = obj_in.model_dump(exclude={"items", "allocations", "receipt_number", "is_cancelled"})
        db_obj = self.model(**receipt_data, receipt_number=receipt_number, created_by=created_by)
        db_obj.receipt_status = "CANCELLED" if getattr(obj_in, "is_cancelled", False) else "UNASSIGNED"

        db.add(db_obj)
        db.flush()  # mint the receipt id before dependants reference it

        for line_no, item in enumerate(obj_in.items, start=1):
            db.add(ReceiptItem(
                receipt_id=db_obj.id,
                item_type=item.item_type,
                particular_id=item.particular_id,
                particular_name=item.particular_name,
                description=item.description,
                amount=item.amount,
                line_no=line_no,
                created_by=created_by,
            ))

        allocations = list(obj_in.allocations)
        for alloc in allocations:
            if isinstance(alloc, dict):
                alloc_data = alloc
            else:
                alloc_data = alloc.model_dump()
            db.add(ReceiptAllocation(
                receipt_id=db_obj.id,
                member_id=alloc_data.get("member_id"),
                associate_id=alloc_data.get("associate_id"),
                membership_id=alloc_data.get("membership_id"),
                allocated_amount=alloc_data["allocated_amount"],
                created_by=created_by,
            ))

        from services import receipt_status
        receipt_status.refresh(db, db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj


def allocated_total(db: Session, receipt_id: int) -> float:
    """Sum of the live allocations against a receipt."""
    from sqlalchemy import func

    total = (
        db.query(func.coalesce(func.sum(ReceiptAllocation.allocated_amount), 0))
        .filter(
            ReceiptAllocation.receipt_id == receipt_id,
            ReceiptAllocation.is_deleted == False,
        )
        .scalar()
    )
    return float(total or 0)


receipt = CRUDReceipt(Receipt)
