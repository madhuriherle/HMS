from sqlalchemy import String, BigInteger, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class UserActivityLog(AuditMixin, Base):
    __tablename__ = "user_activity_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False) 
    entity_type: Mapped[str] = mapped_column(String(50), nullable=True) 
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)

class MemberActivityLog(AuditMixin, Base):
    __tablename__ = "member_activity_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False) 
    details: Mapped[dict] = mapped_column(JSON, nullable=True)
    # Who performed the activity (nullable for system/online self-service rows).
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
