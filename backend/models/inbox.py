from sqlalchemy import String, BigInteger, Boolean, DateTime, Text, ForeignKey, JSON, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin


class AppNotification(AuditMixin, Base):
    """In-app notification inbox entry (Mangalya parity: notification/user_notification).

    Targeting:
    - user_id set      → personal notification for that user
    - user_id NULL     → broadcast visible to everyone
    Read tracking lives on AppNotificationRead so broadcasts don't fan out.
    """
    __tablename__ = "app_notifications"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # What produced it: MANUAL, EVENT, EXPIRY_REMINDER, CAMPAIGN, SYSTEM…
    source: Mapped[str] = mapped_column(String(50), default="MANUAL", nullable=False)
    # Optional deep-link context for the mobile app (e.g. {"member_id": 5}).
    data: Mapped[dict] = mapped_column(JSON, nullable=True)
    sent_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)


class AppNotificationRead(AuditMixin, Base):
    __tablename__ = "app_notification_reads"
    __table_args__ = (
        Index(
            "uq_app_notification_reads_active", "notification_id", "user_id",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    notification_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_notifications.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    read_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)


class UserDeviceToken(AuditMixin, Base):
    """Push-notification device tokens (FCM/APNs) per user (Mangalya parity)."""
    __tablename__ = "user_device_tokens"
    __table_args__ = (
        Index(
            "uq_user_device_tokens_active", "user_id", "device_token",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    device_token: Mapped[str] = mapped_column(Text, nullable=False)
    # FCM (android/web) or APNS (ios).
    platform: Mapped[str] = mapped_column(String(10), default="FCM", nullable=False)
    device_name: Mapped[str] = mapped_column(String(150), nullable=True)
    last_used_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
