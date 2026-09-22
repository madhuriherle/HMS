from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class NotificationTemplate(AuditMixin, Base):
    __tablename__ = "notification_templates"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    template_name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    provider_template_id: Mapped[str] = mapped_column(String(100), nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="en")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class NotificationCampaign(AuditMixin, Base):
    __tablename__ = "notification_campaigns"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    campaign_name: Mapped[str] = mapped_column(String(150), nullable=False)
    template_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notification_templates.id"), nullable=False)
    target_audience: Mapped[str] = mapped_column(String(50), nullable=True) 
    scheduled_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")

class NotificationRecipient(AuditMixin, Base):
    __tablename__ = "notification_recipients"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notification_campaigns.id"), nullable=False)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")

class NotificationMessage(AuditMixin, Base):
    __tablename__ = "notification_messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notification_campaigns.id"), nullable=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    recipient_number: Mapped[str] = mapped_column(String(20), nullable=False)
    message_content: Mapped[str] = mapped_column(Text, nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(20), default="SENT")
    provider_response: Mapped[dict] = mapped_column(JSON, nullable=True)

class NotificationDeliveryLog(AuditMixin, Base):
    __tablename__ = "notification_delivery_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    message_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notification_messages.id"), nullable=False)
    status_update: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at_provider: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)

class NotificationImportBatch(AuditMixin, Base):
    __tablename__ = "notification_import_batches"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notification_campaigns.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
