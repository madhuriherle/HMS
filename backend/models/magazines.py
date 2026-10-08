from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class MagazineSubscription(AuditMixin, Base):
    __tablename__ = "magazine_subscriptions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    address_override: Mapped[str] = mapped_column(Text, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)

class MagazineDeliveryPause(AuditMixin, Base):
    __tablename__ = "magazine_delivery_pauses"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    subscription_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("magazine_subscriptions.id"), nullable=False)
    pause_start_date: Mapped[Date] = mapped_column(Date, nullable=False)
    pause_end_date: Mapped[Date] = mapped_column(Date, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=True)

class MagazineReturn(AuditMixin, Base):
    __tablename__ = "magazine_returns"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    subscription_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("magazine_subscriptions.id"), nullable=False)
    issue_month_year: Mapped[str] = mapped_column(String(20), nullable=False)
    return_date: Mapped[Date] = mapped_column(Date, nullable=False)
    return_reason: Mapped[str] = mapped_column(Text, nullable=True)
    follow_up_status: Mapped[str] = mapped_column(String(30), default="PENDING")

class MagazineDeliveryBatch(AuditMixin, Base):
    __tablename__ = "magazine_delivery_batches"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    batch_name: Mapped[str] = mapped_column(String(100), nullable=False)
    issue_month_year: Mapped[str] = mapped_column(String(20), nullable=False)
    dispatch_date: Mapped[Date] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")

class MagazineLabelBatch(AuditMixin, Base):
    __tablename__ = "magazine_label_batches"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    batch_name: Mapped[str] = mapped_column(String(100), nullable=False)
    generation_date: Mapped[Date] = mapped_column(Date, nullable=False)
    issue_month_year: Mapped[str] = mapped_column(String(20), nullable=False)
    total_labels: Mapped[int] = mapped_column(BigInteger, default=0)
    filters_applied: Mapped[str] = mapped_column(Text, nullable=True)

class MagazineLabelBatchItem(AuditMixin, Base):
    __tablename__ = "magazine_label_batch_items"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    label_batch_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("magazine_label_batches.id"), nullable=False)
    recipient_type: Mapped[str] = mapped_column(String(30), nullable=False)  # MEMBER, AFFILIATION, ASSOCIATE, PRESS
    recipient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    label_address: Mapped[str] = mapped_column(Text, nullable=True)
    is_return: Mapped[bool] = mapped_column(Boolean, default=False)
