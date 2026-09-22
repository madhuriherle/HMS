from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Numeric, Text, ForeignKey, JSON, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class Member(AuditMixin, Base):
    __tablename__ = "members"
    __table_args__ = (
        # One active member per mobile number (deleted members don't block it).
        Index(
            "uq_members_mobile_active", "mobile",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=True)
    first_name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name_en: Mapped[str] = mapped_column(String(100), nullable=True)
    last_name_en: Mapped[str] = mapped_column(String(100), nullable=True)
    full_name_kn: Mapped[str] = mapped_column(String(250), nullable=True)
    gender: Mapped[str] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[Date] = mapped_column(Date, nullable=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    mobile_country_code: Mapped[str] = mapped_column(String(5), default="+91")
    alternate_mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str] = mapped_column(String(255), nullable=True)
    locality: Mapped[str] = mapped_column(String(150), nullable=True)
    address_line1_kn: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2_kn: Mapped[str] = mapped_column(String(255), nullable=True)
    locality_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    pincode_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    state_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    district_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    taluk_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    photo_path: Mapped[str] = mapped_column(Text, nullable=True)
    registration_source: Mapped[str] = mapped_column(String(20), default="ONLINE")
    registration_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    approval_status: Mapped[str] = mapped_column(String(20), default="UNAPPROVED")
    member_status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    approved_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)

class MemberMembership(AuditMixin, Base):
    __tablename__ = "member_memberships"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    membership_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=False)
    price_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_type_prices.id"), nullable=True)
    membership_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=True)
    applied_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    activated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")

class MemberDocument(AuditMixin, Base):
    __tablename__ = "member_documents"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    document_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("document_types.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=True)
    verification_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    verified_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)

class MemberApprovalHistory(AuditMixin, Base):
    __tablename__ = "member_approval_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    old_status: Mapped[str] = mapped_column(String(30), nullable=True)
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=True)
    acted_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    acted_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)

class MemberProfileChangeRequest(AuditMixin, Base):
    __tablename__ = "member_profile_change_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=True)
    old_values: Mapped[dict] = mapped_column(JSON, nullable=True)
    new_values: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    reviewed_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, nullable=True)

class MemberProfileHistory(AuditMixin, Base):
    __tablename__ = "member_profile_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    old_value: Mapped[str] = mapped_column(Text, nullable=True)
    new_value: Mapped[str] = mapped_column(Text, nullable=True)
    change_request_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("member_profile_change_requests.id"), nullable=True)
    changed_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)

class MembershipTypeChangeRequest(AuditMixin, Base):
    __tablename__ = "membership_type_change_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    current_membership_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("member_memberships.id"), nullable=False)
    requested_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=False)
    requested_price_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_type_prices.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    reviewed_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, nullable=True)

class MembershipTypeHistory(AuditMixin, Base):
    __tablename__ = "membership_type_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    membership_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("member_memberships.id"), nullable=False)
    old_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=True)
    new_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=False)
    old_price: Mapped[float] = mapped_column(Numeric(12,2), nullable=True)
    new_price: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), nullable=True)
    changed_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=True)

class MemberDeletionRequest(AuditMixin, Base):
    __tablename__ = "member_deletion_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    deletion_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    reviewed_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, nullable=True)
    executed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)

class MemberKycRequest(AuditMixin, Base):
    __tablename__ = "member_kyc_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sent_to: Mapped[str] = mapped_column(String(255), nullable=False)
    sent_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    submitted_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
