from sqlalchemy import text
from sqlalchemy import Index
from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Numeric, Text, ForeignKey, CHAR, JSON, Enum
from typing import Optional
from sqlalchemy.orm import Mapped, mapped_column, relationship, backref
from models.base import Base, AuditMixin
import enum

class State(AuditMixin, Base):
    __tablename__ = "states"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    code: Mapped[str] = mapped_column(String(20), nullable=True)
    country_code: Mapped[str] = mapped_column(CHAR(3), default='IND')
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class District(AuditMixin, Base):
    __tablename__ = "districts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    state_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("states.id"), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    code: Mapped[str] = mapped_column(String(20), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class Taluk(AuditMixin, Base):
    __tablename__ = "taluks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    code: Mapped[str] = mapped_column(String(20), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class Village(AuditMixin, Base):
    """A village of the government's Local Government Directory, with the taluk it is in (used to suggest a taluk, and to check one)."""
    __tablename__ = "villages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    state_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("states.id"), nullable=False)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=False)
    taluk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("taluks.id"), nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    name_kn: Mapped[str] = mapped_column(String(200), nullable=True)
    lgd_code: Mapped[str] = mapped_column(String(20), nullable=True, index=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class PostalCode(AuditMixin, Base):
    __tablename__ = "postal_codes"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    pincode: Mapped[str] = mapped_column(CHAR(6), nullable=False)
    post_office_name: Mapped[str] = mapped_column(String(150), nullable=True)
    state_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("states.id"), nullable=False)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=False)
    taluk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("taluks.id"), nullable=True)
    # the village of the government directory this post office is named after (set by services/pincode_map.py)
    village_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("villages.id"), nullable=True, index=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class MembershipType(AuditMixin, Base):
    __tablename__ = "membership_types"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    chart_color: Mapped[str] = mapped_column(String(9), nullable=True)  # #RRGGBB, used for this type on the dashboard

class MembershipTypePrice(AuditMixin, Base):
    __tablename__ = "membership_type_prices"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    membership_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("membership_types.id"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12,2), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), default='INR')
    effective_from: Mapped[Date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[Date] = mapped_column(Date, nullable=True)
    change_reason: Mapped[str] = mapped_column(Text, nullable=True)

class HmsSetting(AuditMixin, Base):
    __tablename__ = "hms_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    setting_key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    setting_value: Mapped[dict] = mapped_column(JSON, nullable=False)
    data_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)

class DocumentType(AuditMixin, Base):
    __tablename__ = "document_types"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class Particular(AuditMixin, Base):
    __tablename__ = "particulars"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("particulars.id"), nullable=True)
    # Optional service this particular belongs to (Temple / Mangalya / Hall / Magazine),
    # so a receipt line can be attributed to a service on the member profile.
    service_type_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("service_types.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    # Set on a MAIN particular (its sub types follow it): its money counts toward a member's membership credit,
    # and Receipt Entry asks for a description when it has no sub types.
    pays_for_membership: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    needs_description: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    children = relationship("Particular", backref=backref("parent", remote_side=[id]))

class ServiceType(AuditMixin, Base):
    __tablename__ = "service_types"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("service_types.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    children = relationship("ServiceType", backref=backref("parent", remote_side=[id]))


class Bank(AuditMixin, Base):
    __tablename__ = "banks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    account_number: Mapped[str] = mapped_column(String(50), nullable=True)
    branch_name: Mapped[str] = mapped_column(String(100), nullable=True)
    ifsc_code: Mapped[str] = mapped_column(String(20), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class PaymentMode(AuditMixin, Base):
    __tablename__ = "payment_modes"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    payment_mode: Mapped[str] = mapped_column(String(50), nullable=False)
    payment_type: Mapped[str] = mapped_column(String(50), nullable=False)
    bank_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("banks.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    bank = relationship("Bank")


# ─── Personal masters ───
# Generic id+name(+Kannada)+status shape. Gotra is part of the Sabha's own
# member register (kept); the other horoscope masters (nakshatra, rashi, masa,
# mithi, samvathsara) were removed in migration 0014 — Mangalya owns them.

class Gotra(AuditMixin, Base):
    __tablename__ = "gotras"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class NameTitle(AuditMixin, Base):
    """A title before a member's name (SRI., SMT., DR. ...). Members keep the title as text."""
    __tablename__ = "name_titles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(30), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)   # not used; the shared master code expects it
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class Qualification(AuditMixin, Base):
    __tablename__ = "qualifications"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class NativePlace(AuditMixin, Base):
    __tablename__ = "native_places"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


class DeletionReason(AuditMixin, Base):
    """Master for member-deletion reasons (Mangalya parity: delete_reason).
    Deletion requests pick from this list; free text remains as fallback."""

    __tablename__ = "deletion_reasons"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(150), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(200), nullable=True)
    # Applies to SOFT and/or PERMANENT deletion flows (both when NULL).
    applies_to: Mapped[str] = mapped_column(String(10), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


# Unique among live rows only, so a soft-deleted record never blocks re-using its code/number.
Index("uq_membership_types_code_active", MembershipType.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
Index("uq_document_types_code_active", DocumentType.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
Index("uq_particulars_code_active", Particular.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
Index("uq_service_types_code_active", ServiceType.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
Index("uq_banks_code_active", Bank.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))


class LookupValue(AuditMixin, Base):
    """One entry of a fixed list the screens show (child relations, receipt statuses, country codes ...).
    list_code names the list; extra carries one optional detail (a chip colour class, a dial code)."""
    __tablename__ = "lookup_values"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    list_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(150), nullable=False)
    extra: Mapped[str] = mapped_column(String(60), nullable=True)
    sort_order: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status: Mapped[bool] = mapped_column(Boolean, default=True)


Index("uq_lookup_values_list_code_active", LookupValue.__table__.c.list_code, LookupValue.__table__.c.code, unique=True,
      postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = false"))
