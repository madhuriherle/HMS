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

class OrganisationSettings(AuditMixin, Base):
    """Singleton row (id = 1) behind the Settings screen: organisation
    profile, contact details, receipt print-header (the physical receipt-book
    header: bilingual name/address, reg & ISO numbers, payment-mode labels,
    signature titles, footer note) and notification preferences.

    Credentials (SMTP / WhatsApp API keys) stay in the environment — see
    core/config.py; this row only carries what the office can edit.
    """
    __tablename__ = "organisation_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # ── Organisation profile ────────────────────────────────
    name_en: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    name_kn: Mapped[str] = mapped_column(String(200), nullable=True)
    address_en: Mapped[str] = mapped_column(Text, nullable=True)
    address_kn: Mapped[str] = mapped_column(Text, nullable=True)
    registration_no: Mapped[str] = mapped_column(String(50), nullable=True)
    iso_cert_no: Mapped[str] = mapped_column(String(50), nullable=True)
    logo_path: Mapped[str] = mapped_column(String(255), nullable=True)
    website: Mapped[str] = mapped_column(String(200), nullable=True)

    # ── Contact settings ────────────────────────────────────
    phone: Mapped[str] = mapped_column(String(30), nullable=True)
    mobile: Mapped[str] = mapped_column(String(30), nullable=True)
    email: Mapped[str] = mapped_column(String(200), nullable=True)

    # ── Print-header settings (receipt book) ────────────────
    print_header_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    receipt_footer_note_en: Mapped[str] = mapped_column(Text, nullable=True)
    receipt_footer_note_kn: Mapped[str] = mapped_column(Text, nullable=True)
    president_title_en: Mapped[str] = mapped_column(String(50), nullable=True)
    president_title_kn: Mapped[str] = mapped_column(String(50), nullable=True)
    secretary_title_en: Mapped[str] = mapped_column(String(50), nullable=True)
    secretary_title_kn: Mapped[str] = mapped_column(String(50), nullable=True)
    treasurer_title_en: Mapped[str] = mapped_column(String(50), nullable=True)
    treasurer_title_kn: Mapped[str] = mapped_column(String(50), nullable=True)
    pay_mode_cash_en: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_cash_kn: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_cheque_en: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_cheque_kn: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_dd_en: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_dd_kn: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_upi_en: Mapped[str] = mapped_column(String(30), nullable=True)
    pay_mode_upi_kn: Mapped[str] = mapped_column(String(30), nullable=True)

    # ── Notification settings (credentials live in env config) ─
    notify_email_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_sms_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_reply_to_email: Mapped[str] = mapped_column(String(200), nullable=True)
    notify_footer_note: Mapped[str] = mapped_column(Text, nullable=True)
    # Screen settings that have no column of their own (organisation type, extra
    # contact people, working hours, notification toggles...), stored as one
    # JSON object so the panel keeps nothing in the browser.
    extra: Mapped[dict] = mapped_column(JSON, nullable=True)
