from typing import List, Literal, Optional
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

# Receipts are entered at the counter (OFFLINE) or from the website/app (ONLINE).
ReceiptSource = Literal["ONLINE", "OFFLINE"]


def _check_non_negative(field: str, value: float) -> float:
    if value < 0:
        raise ValueError(f"{field} must be >= 0")
    return value


class ReceiptItemBase(BaseModel):
    item_type: str
    description: Optional[str] = None
    amount: float

    @field_validator("amount")
    @classmethod
    def amount_non_negative(cls, v: float) -> float:
        return _check_non_negative("amount", v)


class ReceiptAllocationIn(BaseModel):
    """Payee mapping captured together with the receipt entry.

    The payee is exactly one of: a member (lands in the member's profile
    financial history) or an associate (donor/well-wisher who isn't a
    member — receipt tracking maps those to engagements.associates).
    """

    member_id: Optional[int] = None
    associate_id: Optional[int] = None
    membership_id: Optional[int] = None
    allocated_amount: float

    @field_validator("allocated_amount")
    @classmethod
    def allocated_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("allocated_amount must be > 0")
        return v

    @model_validator(mode="after")
    def _exactly_one_payee(self):
        if self.member_id is not None and self.associate_id is not None:
            raise ValueError("Cannot link both member_id and associate_id")
        if self.member_id is None and self.associate_id is None:
            raise ValueError("allocation needs exactly one payee: member_id or associate_id")
        if self.associate_id is not None and self.membership_id is not None:
            raise ValueError("membership_id can only be set for member allocations")
        return self


class ReceiptBase(BaseModel):
    receipt_date: date
    receipt_type: str
    payer_name: Optional[str] = None
    payment_mode: str
    transaction_reference: Optional[str] = None
    bank_account: Optional[str] = None
    transaction_date: Optional[date] = None
    gross_amount: float
    discount_amount: float = 0.0
    net_amount: float
    source: ReceiptSource = "ONLINE"
    is_renewal: bool = False
    cheque_number: Optional[str] = None
    cheque_date: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("gross_amount", "discount_amount", "net_amount")
    @classmethod
    def amounts_non_negative(cls, v: float, info) -> float:
        v = _check_non_negative(info.field_name, v)
        if v > 9_999_999_999.99:  # the column is NUMERIC(12,2)
            raise ValueError(f"{info.field_name} is too large")
        return v

    @field_validator("payer_name")
    @classmethod
    def payer_name_fits(cls, v):
        if v is not None and len(v.strip()) > 200:
            raise ValueError("payer_name can be at most 200 characters")
        return v

    @field_validator("transaction_reference")
    @classmethod
    def reference_fits(cls, v):
        if v is not None and len(v.strip()) > 150:
            raise ValueError("transaction_reference can be at most 150 characters")
        return v

    @field_validator("cheque_number")
    @classmethod
    def cheque_fits(cls, v):
        if v is not None and len(v.strip()) > 50:
            raise ValueError("cheque_number can be at most 50 characters")
        return v

    @field_validator("receipt_date")
    @classmethod
    def date_not_in_future(cls, v):
        if v is not None and v > date.today():
            raise ValueError("receipt_date cannot be in the future")
        return v

    @model_validator(mode="after")
    def totals_consistent(self):
        if abs(self.net_amount - (self.gross_amount - self.discount_amount)) > 0.01:
            raise ValueError("net_amount must equal gross_amount - discount_amount")
        return self


class ReceiptCreate(ReceiptBase):
    receipt_number: Optional[str] = None

    @field_validator("receipt_number")
    @classmethod
    def number_fits(cls, v):
        if v is not None and len(v.strip()) > 50:
            raise ValueError("receipt_number can be at most 50 characters")
        return v

    items: List[ReceiptItemBase] = []
    # Map the receipt to members in the same call as the entry (optional).
    allocations: List[ReceiptAllocationIn] = []


class ReceiptUpdate(BaseModel):
    """Manage a receipt entry. payment_status is intentionally absent —
    use POST /receipts/{id}/cancel so the cancellation is recorded."""

    receipt_date: Optional[date] = None
    receipt_type: Optional[str] = None
    payer_name: Optional[str] = None
    payment_mode: Optional[str] = None
    transaction_reference: Optional[str] = None
    gross_amount: Optional[float] = None
    discount_amount: Optional[float] = None
    net_amount: Optional[float] = None
    source: Optional[ReceiptSource] = None
    is_renewal: Optional[bool] = None
    cheque_number: Optional[str] = None
    cheque_date: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("gross_amount", "discount_amount", "net_amount")
    @classmethod
    def amounts_non_negative(cls, v: float, info) -> float:
        return _check_non_negative(info.field_name, v)

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


class ReceiptAllocationCreate(BaseModel):
    member_id: Optional[int] = None
    associate_id: Optional[int] = None
    membership_id: Optional[int] = None
    allocated_amount: float

    @field_validator("allocated_amount")
    @classmethod
    def allocated_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("allocated_amount must be > 0")
        return v

    @model_validator(mode="after")
    def _exactly_one_payee(self):
        if self.member_id is not None and self.associate_id is not None:
            raise ValueError("Cannot link both member_id and associate_id")
        if self.member_id is None and self.associate_id is None:
            raise ValueError("allocation needs exactly one payee: member_id or associate_id")
        if self.associate_id is not None and self.membership_id is not None:
            raise ValueError("membership_id can only be set for member allocations")
        return self


class ReceiptAllocation(BaseModel):
    id: int
    receipt_id: int
    member_id: Optional[int] = None
    associate_id: Optional[int] = None
    membership_id: Optional[int] = None
    allocated_amount: float
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ReceiptAllocationWithMember(ReceiptAllocation):
    member_name: Optional[str] = None
    associate_name: Optional[str] = None


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
