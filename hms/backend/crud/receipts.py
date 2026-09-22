from typing import Optional
from crud.base import CRUDBase
from models.receipts import Receipt, ReceiptItem
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
        receipt_data = obj_in.model_dump(exclude={"items"})
        db_obj = self.model(**receipt_data, receipt_number=receipt_number, created_by=created_by)
        
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        
        for item in obj_in.items:
            db_item = ReceiptItem(
                receipt_id=db_obj.id,
                item_type=item.item_type,
                description=item.description,
                amount=item.amount,
                created_by=created_by
            )
            db.add(db_item)
            
        db.commit()
        db.refresh(db_obj)
        return db_obj

receipt = CRUDReceipt(Receipt)
