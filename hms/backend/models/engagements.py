from sqlalchemy import String, BigInteger, Boolean, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class Affiliation(AuditMixin, Base):
    __tablename__ = "affiliations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    group_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_person: Mapped[str] = mapped_column(String(150), nullable=True)
    contact_number: Mapped[str] = mapped_column(String(20), nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=True)
    magazine_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

class AffiliationContact(AuditMixin, Base):
    __tablename__ = "affiliation_contacts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    affiliation_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("affiliations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True)
    designation: Mapped[str] = mapped_column(String(100), nullable=True)

class AffiliationMagazineSetting(AuditMixin, Base):
    __tablename__ = "affiliation_magazine_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    affiliation_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("affiliations.id"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    address_override: Mapped[str] = mapped_column(Text, nullable=True)

class Associate(AuditMixin, Base):
    __tablename__ = "associates"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    organization: Mapped[str] = mapped_column(String(255), nullable=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=True)
    magazine_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

class AssociateMagazineSetting(AuditMixin, Base):
    __tablename__ = "associate_magazine_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    associate_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("associates.id"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    address_override: Mapped[str] = mapped_column(Text, nullable=True)

class PressMedia(AuditMixin, Base):
    __tablename__ = "press_media"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    organization_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reporter_name: Mapped[str] = mapped_column(String(150), nullable=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=True)
    magazine_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

class PressMediaMagazineSetting(AuditMixin, Base):
    __tablename__ = "press_media_magazine_settings"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    press_media_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("press_media.id"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    address_override: Mapped[str] = mapped_column(Text, nullable=True)

class CommitteeCategory(AuditMixin, Base):
    __tablename__ = "committee_categories"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name_en: Mapped[str] = mapped_column(String(150), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(200), nullable=True)
    display_on_website: Mapped[bool] = mapped_column(Boolean, default=True)

class CommitteeSubcategory(AuditMixin, Base):
    __tablename__ = "committee_subcategories"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("committee_categories.id"), nullable=False)
    name_en: Mapped[str] = mapped_column(String(150), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(200), nullable=True)
    display_on_website: Mapped[bool] = mapped_column(Boolean, default=True)

class CommitteeTerm(AuditMixin, Base):
    __tablename__ = "committee_terms"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    term_name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[str] = mapped_column(String(20), nullable=True)
    end_date: Mapped[str] = mapped_column(String(20), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

class CommitteeMember(AuditMixin, Base):
    __tablename__ = "committee_members"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("committee_categories.id"), nullable=False)
    subcategory_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("committee_subcategories.id"), nullable=True)
    term_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("committee_terms.id"), nullable=True)
    member_name: Mapped[str] = mapped_column(String(150), nullable=False)
    designation: Mapped[str] = mapped_column(String(100), nullable=True)
    display_on_website: Mapped[bool] = mapped_column(Boolean, default=True)

class CommitteeMemberLink(AuditMixin, Base):
    __tablename__ = "committee_member_links"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    committee_member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("committee_members.id"), nullable=False)
    hms_member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
