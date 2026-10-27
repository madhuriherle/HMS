from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Numeric, Text, ForeignKey, JSON, Index, text, event, inspect as sa_inspect
from sqlalchemy.orm import Mapped, mapped_column, synonym
from models.base import Base, AuditMixin

class Member(AuditMixin, Base):
    __tablename__ = "members"
    __table_args__ = (
        # Non-unique index for fast lookup; family members can share the same mobile.
        Index(
            "ix_members_mobile_active", "mobile",
            unique=False,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    # The one permanent membership number, given at approval (null until then). Formerly called member_code;
    # the old name still works in code as an alias.
    membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    member_code = synonym("membership_number")
    # The numbers the old register gave: CusNo is the OLD membership number (kept for members who have no new one yet),
    # CusNoOld a further reference. Both are only kept and searched, never used as a membership number.
    old_membership_number: Mapped[str] = mapped_column(String(30), nullable=True, index=True)
    legacy_ref_number: Mapped[str] = mapped_column(String(30), nullable=True)

    @property
    def display_name(self) -> str:
        """The name as typed (full_name_en); older rows without it fall back to first / middle / last."""
        return self.full_name_en or " ".join(p.strip() for p in (self.first_name_en, self.middle_name_en, self.last_name_en) if p and p.strip())
    # The name as the office types it (one Full Name box). first / middle / last below are kept in step with it.
    full_name_en: Mapped[str] = mapped_column(String(250), nullable=True, index=True)
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
    native_place_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("native_places.id"), nullable=True)
    native_place_text: Mapped[str] = mapped_column(String(150), nullable=True)
    qualification_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("qualifications.id"), nullable=True)
    qualification_text: Mapped[str] = mapped_column(String(150), nullable=True)
    gotra_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("gotras.id"), nullable=True)
    gotra_text: Mapped[str] = mapped_column(String(100), nullable=True)
    occupation: Mapped[str] = mapped_column(String(150), nullable=True)
    designation: Mapped[str] = mapped_column(String(150), nullable=True)
    # The native (home town) address is one free-text box; the flag means it is the same as the communication address.
    native_address: Mapped[str] = mapped_column(Text, nullable=True)
    native_same_as_current: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
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
    # whose mobile / WhatsApp number it is when not the member's own (a shared family mobile)
    mobile_owner_name: Mapped[str] = mapped_column(String(150), nullable=True)
    whatsapp_owner_relation: Mapped[str] = mapped_column(String(30), nullable=True)
    whatsapp_owner_name: Mapped[str] = mapped_column(String(150), nullable=True)
    magazine_needed: Mapped[bool] = mapped_column(Boolean, nullable=True)
    magazine_delivery_address: Mapped[str] = mapped_column(Text, nullable=True)
    magazine_kind: Mapped[str] = mapped_column(String(10), nullable=True)  # PHYSICAL or EMAIL (e-copy)
    magazine_email: Mapped[str] = mapped_column(String(191), nullable=True)
    membership_type_category: Mapped[str] = mapped_column(String(80), nullable=True)
    referred_by_number: Mapped[str] = mapped_column(String(30), nullable=True)
    referred_by_name: Mapped[str] = mapped_column(String(150), nullable=True)
    family_membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
    family_membership_name: Mapped[str] = mapped_column(String(150), nullable=True)
    # payment entered with the application (mode, bank, amount, receipt date, transaction id/date, remarks)
    registration_payment: Mapped[dict] = mapped_column(JSON, nullable=True)
    login_count: Mapped[int] = mapped_column(BigInteger, default=0)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    # What the legacy register had in the mobile column when it was not a usable mobile (a landline, a number with a
    # missing or extra digit...). The mobile itself stays empty; this keeps the original so the office can correct it.
    mobile_raw: Mapped[str] = mapped_column(String(50), nullable=True)
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
    pincode_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("postal_codes.id"), nullable=True)
    state_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("states.id"), nullable=True)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=True)
    taluk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("taluks.id"), nullable=True)
    photo_path: Mapped[str] = mapped_column(Text, nullable=True)
    # Referral: which member brought this person in.
    referred_by_member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)
    registration_source: Mapped[str] = mapped_column(String(20), default="ONLINE")
    registration_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    approval_status: Mapped[str] = mapped_column(String(20), default="UNAPPROVED")
    member_status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    approved_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    # Office phone check: the member's details confirmed on a call (latest outcome here, every call in member_verification_logs).
    verification_status: Mapped[str] = mapped_column(String(20), default="NOT_VERIFIED", server_default="NOT_VERIFIED")
    verified_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    verification_remark: Mapped[str] = mapped_column(Text, nullable=True)

class MemberVerificationLog(AuditMixin, Base):
    """One call to a member: its outcome and what was said."""
    __tablename__ = "member_verification_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    remark: Mapped[str] = mapped_column(Text, nullable=True)
    called_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    called_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)

class MemberMembership(AuditMixin, Base):
    __tablename__ = "member_memberships"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    membership_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=False)
    price_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_type_prices.id"), nullable=True)
    membership_number: Mapped[str] = mapped_column(String(30), nullable=True)
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

class MemberMeetingExport(AuditMixin, Base):
    """One applicant on one meeting PDF. The Unapproved / Assigned screens filter on these rows ("Only exported",
    or exported on a given day) so the committee sees exactly the list that went to the meeting."""
    __tablename__ = "member_meeting_exports"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False, index=True)
    exported_on: Mapped[Date] = mapped_column(Date, nullable=False, index=True)
    export_ref: Mapped[str] = mapped_column(String(40), nullable=False)  # one value per PDF, shared by its rows

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


# Unique among live rows only, so a soft-deleted record never blocks re-using its code/number.
Index("uq_members_membership_number_active", Member.__table__.c.membership_number, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
Index("uq_member_memberships_membership_number_active", MemberMembership.__table__.c.membership_number, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))


class MemberImportRun(AuditMixin, Base):
    """One bulk member import (a file imported in batches): who ran it, when, the file and what happened."""
    __tablename__ = "member_import_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    run_id: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=True)
    total_rows: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    processed_rows: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    success_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    skipped_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    skip_duplicates: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    skipped: Mapped[list] = mapped_column(JSON, nullable=True)  # the first rows that were left out, with the reason
    warning_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    warnings: Mapped[list] = mapped_column(JSON, nullable=True)  # rows imported with something to look at, e.g. a shared mobile


def split_full_name(full: str) -> tuple:
    """(first, middle, last) the way the Register Member screen splits a Full Name: first word, the words in
    between, last word. One word is only a first name."""
    parts = " ".join(str(full or "").split()).split(" ")
    parts = [p for p in parts if p]
    if not parts:
        return "", None, None
    return parts[0], (" ".join(parts[1:-1]) or None), (parts[-1] if len(parts) > 1 else None)


def join_name_parts(first, middle, last) -> str:
    return " ".join(p.strip() for p in (first, middle, last) if p and str(p).strip())


def _sync_member_names(mapper, connection, member, *, inserting: bool) -> None:
    """Whichever side was set wins: a typed Full Name fills first / middle / last (when those were not given), and
    edited parts rebuild the Full Name. Both are always saved together."""
    state = sa_inspect(member)
    full = " ".join(str(member.full_name_en or "").split())
    if inserting:
        split_from_full = bool(full) and not member.first_name_en
    else:
        full_changed = state.attrs.full_name_en.history.has_changes()
        parts_changed = any(state.attrs[k].history.has_changes() for k in ("first_name_en", "middle_name_en", "last_name_en"))
        split_from_full = bool(full) and full_changed and not parts_changed
    if split_from_full:
        member.full_name_en = full
        member.first_name_en, member.middle_name_en, member.last_name_en = split_full_name(full)
    else:
        member.full_name_en = join_name_parts(member.first_name_en, member.middle_name_en, member.last_name_en) or None


event.listen(Member, "before_insert", lambda m, c, t: _sync_member_names(m, c, t, inserting=True))
event.listen(Member, "before_update", lambda m, c, t: _sync_member_names(m, c, t, inserting=False))
