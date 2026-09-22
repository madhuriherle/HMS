from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict

class ReceiptItemBase(BaseModel):
    item_type: str
    description: Optional[str] = None
    amount: float

class ReceiptBase(BaseModel):
    receipt_date: date
    receipt_type: str
    payer_name: Optional[str] = None
    payment_mode: str
    transaction_reference: Optional[str] = None
    gross_amount: float
    discount_amount: float = 0.0
    net_amount: float
    source: str = "ONLINE"
    notes: Optional[str] = None

class ReceiptCreate(ReceiptBase):
    items: List[ReceiptItemBase]

class ReceiptUpdate(BaseModel):
    payment_status: Optional[str] = None
    notes: Optional[str] = None

class ReceiptItemResponse(ReceiptItemBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class ReceiptInDBBase(ReceiptBase):
    id: int
    receipt_number: str
    payment_status: str
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class Receipt(ReceiptInDBBase):
    pass
    # We will map items in a later response model if necessary


class ReceiptCancellationCreate(BaseModel):
    reason: str


class RefundTransactionCreate(BaseModel):
    amount: float
    status: str = "PENDING"
    refund_reference: Optional[str] = None


class PaymentTransactionCreate(BaseModel):
    gateway_reference: Optional[str] = None
    status: str
    amount: float


# Response models — FastAPI cannot serialise live ORM instances directly.
class RefundTransaction(BaseModel):
    id: int
    receipt_id: int
    amount: float
    status: str
    refund_reference: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PaymentTransaction(BaseModel):
    id: int
    receipt_id: int
    gateway_reference: Optional[str] = None
    status: str
    amount: float
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
