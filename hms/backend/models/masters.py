from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Numeric, Text, ForeignKey, CHAR, JSON, Enum
from sqlalchemy.orm import Mapped, mapped_column
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

class PostalCode(AuditMixin, Base):
    __tablename__ = "postal_codes"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    pincode: Mapped[str] = mapped_column(CHAR(6), nullable=False)
    post_office_name: Mapped[str] = mapped_column(String(150), nullable=True)
    state_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("states.id"), nullable=False)
    district_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("districts.id"), nullable=False)
    taluk_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("taluks.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class MembershipType(AuditMixin, Base):
    __tablename__ = "membership_types"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

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
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

class ServiceType(AuditMixin, Base):
    __tablename__ = "service_types"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
