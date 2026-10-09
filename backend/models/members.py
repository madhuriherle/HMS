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
    # Sabha-register personal fields (father/husband name, blood group, …).
    # Horoscope fields (gotra/nakshatra/rashi/masa/mithi/samvathsara) were
    # removed in migration 0014 — Mangalya/matrimony owns those.
    father_husband_name: Mapped[str] = mapped_column(String(150), nullable=True)
    blood_group: Mapped[str] = mapped_column(String(10), nullable=True)
    native_place_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    native_place_text: Mapped[str] = mapped_column(String(150), nullable=True)
    qualification_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    qualification_text: Mapped[str] = mapped_column(String(150), nullable=True)
    gotra_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    gotra_text: Mapped[str] = mapped_column(String(100), nullable=True)
    occupation: Mapped[str] = mapped_column(String(150), nullable=True)
    category: Mapped[str] = mapped_column(String(50), nullable=True)
    company: Mapped[str] = mapped_column(String(150), nullable=True)
    website: Mapped[str] = mapped_column(String(255), nullable=True)
    remarks: Mapped[str] = mapped_column(Text, nullable=True)
    aadhaar_number: Mapped[str] = mapped_column(String(20), nullable=True)
    father_name: Mapped[str] = mapped_column(String(150), nullable=True)
    father_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    mother_name: Mapped[str] = mapped_column(String(150), nullable=True)
    mother_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    is_married: Mapped[bool] = mapped_column(Boolean, nullable=True)
    spouse_name: Mapped[str] = mapped_column(String(150), nullable=True)
    spouse_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    has_children: Mapped[bool] = mapped_column(Boolean, nullable=True)
    children_details: Mapped[list] = mapped_column(JSON, nullable=True)
    # WhatsApp number when different from mobile (notifications prefer it).
    whatsapp_number: Mapped[str] = mapped_column(String(20), nullable=True)
    # Registration-form details (Register New Member screen)
    name_title: Mapped[str] = mapped_column(String(10), nullable=True)
    whatsapp_country_code: Mapped[str] = mapped_column(String(5), nullable=True)
    applied_on_behalf_of: Mapped[str] = mapped_column(String(30), nullable=True)
    magazine_needed: Mapped[bool] = mapped_column(Boolean, nullable=True)
    membership_type_category: Mapped[str] = mapped_column(String(80), nullable=True)
    referred_by_number: Mapped[str] = mapped_column(String(30), nullable=True)
    referred_by_name: Mapped[str] = mapped_column(String(150), nullable=True)
    family_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    family_membership_name: Mapped[str] = mapped_column(String(150), nullable=True)
    # payment entered with the application (mode, bank, amount, receipt date, transaction id/date, remarks)
    registration_payment: Mapped[dict] = mapped_column(JSON, nullable=True)
    login_count: Mapped[int] = mapped_column(BigInteger, default=0)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    mobile_country_code: Mapped[str] = mapped_column(String(5), default="+91")
    alternate_mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str] = mapped_column(String(255), nullable=True)
    locality: Mapped[str] = mapped_column(String(150), nullable=True)
    country: Mapped[str] = mapped_column(String(100), default="India")
    city: Mapped[str] = mapped_column(String(150), nullable=True)
    post: Mapped[str] = mapped_column(String(150), nullable=True)
    # Village-style address parts carried over from the legacy register.
    area: Mapped[str] = mapped_column(String(150), nullable=True)
    place: Mapped[str] = mapped_column(String(150), nullable=True)
    grama: Mapped[str] = mapped_column(String(150), nullable=True)
    village: Mapped[str] = mapped_column(String(150), nullable=True)
    label_point: Mapped[str] = mapped_column(String(100), nullable=True)
    address_remarks: Mapped[str] = mapped_column(Text, nullable=True)
    address_line1_kn: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2_kn: Mapped[str] = mapped_column(String(255), nullable=True)
    locality_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    pincode_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    state_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    district_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    taluk_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    photo_path: Mapped[str] = mapped_column(Text, nullable=True)
    # Referral: which member brought this person in.
    referred_by_member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
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
    # Family membership: dependents point at the head's number (Mangalya
    # parity: family_membership_number / family_membership_name).
    family_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
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

class MemberServiceOptin(AuditMixin, Base):
    """Which HMS services a member has opted into (spec: 'service opted
    details — Magazine, Temple, Mangalya, Hall etc').

    ServiceType is the catalogue; this table is the per-member opt-in against
    it, so the profile screen can render one generic list instead of a
    hand-maintained block per service. Services that need richer lifecycle
    (Magazine: pause/returns/address override) keep their own dedicated table
    and set linked_type/linked_id here rather than being duplicated — the
    optin stays the index of "what did this member opt into", the dedicated
    table stays the source of truth for the details.
    """

    __tablename__ = "member_service_optins"
    __table_args__ = (
        # One opt-in per (member, service) among live rows; a re-opt-in after a
        # cancellation is a new row, and the old one stays soft-deleted.
        Index(
            "uq_member_service_optin_active", "member_id", "service_type_id",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    service_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("service_types.id"), nullable=False)
    # ACTIVE | CANCELLED — an opt-in is either on or explicitly withdrawn.
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    opted_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    opted_via: Mapped[str] = mapped_column(String(20), default="ADMIN")  # ADMIN | MOBILE_APP | WEBSITE
    # Set when this service has a dedicated table (e.g. MAGAZINE →
    # magazine_subscriptions.id) so the profile can join to it.
    linked_type: Mapped[str] = mapped_column(String(30), nullable=True)
    linked_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)


class MemberDeletionRequest(AuditMixin, Base):
    __tablename__ = "member_deletion_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # Master-list reference (Mangalya parity: delete_reason); free text still allowed.
    reason_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("deletion_reasons.id"), nullable=True)
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
