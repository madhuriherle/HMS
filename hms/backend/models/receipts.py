from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Numeric, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class Receipt(AuditMixin, Base):
    __tablename__ = "receipts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    receipt_date: Mapped[Date] = mapped_column(Date, nullable=False)
    receipt_type: Mapped[str] = mapped_column(String(30), nullable=False) 
    payer_name: Mapped[str] = mapped_column(String(200), nullable=True)
    payment_mode: Mapped[str] = mapped_column(String(30), nullable=False) 
    transaction_reference: Mapped[str] = mapped_column(String(150), nullable=True)
    gross_amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    discount_amount: Mapped[float] = mapped_column(Numeric(12,2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(20), default="SUCCESS")
    source: Mapped[str] = mapped_column(String(20), default="ONLINE")
    notes: Mapped[str] = mapped_column(Text, nullable=True)

class ReceiptItem(AuditMixin, Base):
    __tablename__ = "receipt_items"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)

class ReceiptAllocation(AuditMixin, Base):
    __tablename__ = "receipt_allocations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    membership_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("member_memberships.id"), nullable=True)
    allocated_amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)

class PaymentTransaction(AuditMixin, Base):
    __tablename__ = "payment_transactions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    gateway_reference: Mapped[str] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)

class ReceiptCancellation(AuditMixin, Base):
    __tablename__ = "receipt_cancellations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    cancelled_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

class RefundTransaction(AuditMixin, Base):
    __tablename__ = "refund_transactions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    refund_reference: Mapped[str] = mapped_column(String(255), nullable=True)
