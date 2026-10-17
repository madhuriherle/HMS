from sqlalchemy import text
from sqlalchemy import Index, event
from sqlalchemy import String, Integer, BigInteger, Boolean, DateTime, Date, Time, Numeric, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class Receipt(AuditMixin, Base):
    __tablename__ = "receipts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_number: Mapped[str] = mapped_column(String(50), nullable=False)
    receipt_date: Mapped[Date] = mapped_column(Date, nullable=False)
    # "2026-27" (April-March) derived from receipt_date; receipt numbers are unique within it.
    financial_year: Mapped[str] = mapped_column(String(7), nullable=False)
    receipt_type: Mapped[str] = mapped_column(String(30), nullable=False) 
    payer_name: Mapped[str] = mapped_column(String(200), nullable=True)
    payment_mode: Mapped[str] = mapped_column(String(30), nullable=False) 
    transaction_reference: Mapped[str] = mapped_column(String(150), nullable=True)
    # bank account the money went into (online / cheque receipts)
    bank_account: Mapped[str] = mapped_column(String(150), nullable=True)
    transaction_date: Mapped[Date] = mapped_column(Date, nullable=True)
    # What was typed on the entry form about the payer (kept even when the receipt is mapped to a member).
    payer_pan: Mapped[str] = mapped_column(String(10), nullable=True)
    payer_mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    payer_membership_no: Mapped[str] = mapped_column(String(30), nullable=True)
    gross_amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    discount_amount: Mapped[float] = mapped_column(Numeric(12,2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(20), default="SUCCESS")
    source: Mapped[str] = mapped_column(String(20), default="ONLINE")
    # NEW (first registration) vs RENEWAL (Mangalya parity: receipts.renewal).
    is_renewal: Mapped[bool] = mapped_column(Boolean, default=False)
    # Cheque capture (Mangalya parity: cheque_number / cheque_date).
    cheque_number: Mapped[str] = mapped_column(String(50), nullable=True)
    cheque_date: Mapped[Date] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    # One visible status: UNASSIGNED | ASSIGNED | CANCELLED (see services/receipt_status.py).
    # payment_status keeps describing the money.
    receipt_status: Mapped[str] = mapped_column(String(20), default="UNASSIGNED", server_default="UNASSIGNED", nullable=False)
    # Optional period the receipt covers (a seva slot, a sponsorship year...). All four are optional.
    period_from_date: Mapped[Date] = mapped_column(Date, nullable=True)
    period_to_date: Mapped[Date] = mapped_column(Date, nullable=True)
    period_from_time: Mapped[Time] = mapped_column(Time, nullable=True)
    period_to_time: Mapped[Time] = mapped_column(Time, nullable=True)

class ReceiptItem(AuditMixin, Base):
    __tablename__ = "receipt_items"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # One receipt, many lines: the particular this line is for (master row + a name
    # snapshot so history survives a rename), its sub-type / free-text detail and the amount.
    particular_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("particulars.id"), nullable=True)
    particular_name: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    line_no: Mapped[int] = mapped_column(Integer, nullable=True)
    # a copy of the particular's "pays for membership" tick as it was when the receipt was saved
    pays_for_membership: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

class ReceiptAllocation(AuditMixin, Base):
    __tablename__ = "receipt_allocations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=False)
    # Payee: exactly one of member (profile history) or associate (donor/
    # well-wisher recorded in engagements). Enforced at the endpoint, not the
    # DB — SQLite can't ADD COLUMN with a CHECK.
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    associate_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("associates.id"), nullable=True)
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


# Unique among live rows only, so a soft-deleted record never blocks re-using its code/number.
Index("uq_receipts_fy_number_active", Receipt.__table__.c.financial_year, Receipt.__table__.c.receipt_number, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))


def _set_financial_year(mapper, connection, target):
    from services.receipt_numbers import financial_year_for
    if target.receipt_date:
        target.financial_year = financial_year_for(target.receipt_date)


event.listen(Receipt, "before_insert", _set_financial_year)
event.listen(Receipt, "before_update", _set_financial_year)
