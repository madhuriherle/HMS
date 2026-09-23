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
        receipt_data = obj_in.model_dump(exclude={"items", "allocations"})
        db_obj = self.model(**receipt_data, receipt_number=receipt_number, created_by=created_by)

        db.add(db_obj)
        db.flush()  # mint the receipt id before dependants reference it

        for item in obj_in.items:
            db.add(ReceiptItem(
                receipt_id=db_obj.id,
                item_type=item.item_type,
                description=item.description,
                amount=item.amount,
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
                member_id=alloc_data["member_id"],
                membership_id=alloc_data.get("membership_id"),
                allocated_amount=alloc_data["allocated_amount"],
                created_by=created_by,
            ))

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
