from sqlalchemy import String, BigInteger, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class RefreshToken(AuditMixin, Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    device_info: Mapped[str] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

class PasswordResetToken(AuditMixin, Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

class FileAttachment(AuditMixin, Base):
    __tablename__ = "file_attachments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=True)
    uploaded_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    uploaded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)

class ApprovalWorkflow(AuditMixin, Base):
    __tablename__ = "approval_workflows"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    workflow_name: Mapped[str] = mapped_column(String(100), nullable=False)
    steps_config: Mapped[dict] = mapped_column(JSON, nullable=False)

class ApprovalAction(AuditMixin, Base):
    __tablename__ = "approval_actions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=True)

class NumberSequence(AuditMixin, Base):
    __tablename__ = "number_sequences"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    sequence_type: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(20), nullable=True)
    current_value: Mapped[int] = mapped_column(BigInteger, default=0)

class SystemErrorLog(AuditMixin, Base):
    __tablename__ = "system_error_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    stack_trace: Mapped[str] = mapped_column(Text, nullable=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
