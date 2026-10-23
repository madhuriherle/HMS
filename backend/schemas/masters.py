from typing import Optional, List
from datetime import date as date_type, datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core import rules

class _AutoCode(BaseModel):
    """Create schemas that fill in a code from the name when the client sends none."""

    @model_validator(mode="before")
    @classmethod
    def _fill_code(cls, data):
        if isinstance(data, dict) and not str(data.get("code") or "").strip() and data.get("name_en"):
            data = {**data, "code": rules.make_code(data["name_en"])}
        return data


class StateBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    code: Optional[str] = None
    country_code: str = "IND"
    status: bool = True

class StateCreate(StateBase):
    pass

class StateUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    code: Optional[str] = None
    status: Optional[bool] = None

class StateInDBBase(StateBase):
    id: int
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class State(StateInDBBase):
    pass

# District Schemas
class DistrictBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    code: Optional[str] = None
    state_id: int
    status: bool = True

class DistrictCreate(DistrictBase):
    pass

class DistrictUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    code: Optional[str] = None
    state_id: Optional[int] = None
    status: Optional[bool] = None

class District(DistrictBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# Taluk Schemas
class TalukBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    code: Optional[str] = None
    district_id: int
    status: bool = True

class TalukCreate(TalukBase):
    pass

class TalukUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    code: Optional[str] = None
    district_id: Optional[int] = None
    status: Optional[bool] = None

class Taluk(TalukBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PostalCodeBase(BaseModel):
    pincode: str
    post_office_name: Optional[str] = None
    state_id: int
    district_id: int
    taluk_id: Optional[int] = None
    status: bool = True

    @field_validator("pincode")
    @classmethod
    def _validate_pincode(cls, v: str) -> str:
        v = v.strip()
        if not (len(v) == 6 and v.isdigit()):
            raise ValueError("pincode must be exactly 6 digits")
        return v


class PostalCodeCreate(PostalCodeBase):
    pass


class PostalCodeUpdate(BaseModel):
    pincode: Optional[str] = None
    post_office_name: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    taluk_id: Optional[int] = None
    status: Optional[bool] = None


class PostalCode(PostalCodeBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MembershipTypeBase(BaseModel):
    code: Optional[str] = None
    name_en: str
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: bool = True
    chart_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class MembershipTypeCreate(_AutoCode, MembershipTypeBase):
    pass


class MembershipTypeUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None
    chart_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class MembershipType(MembershipTypeBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Membership price schemas ──
class MembershipTypePriceBase(BaseModel):
    membership_type_id: int
    amount: float
    currency: str = "INR"
    effective_from: date_type
    effective_to: Optional[date_type] = None
    change_reason: Optional[str] = None


class MembershipTypePriceCreate(BaseModel):
    amount: float
    currency: str = "INR"
    effective_from: Optional[date_type] = None  # defaults to today
    change_reason: Optional[str] = None


class MembershipTypeOldPriceCreate(BaseModel):
    """An old price for whole financial years: from_year 1959 means FY 1959-60 (1 April 1959)."""
    from_year: int
    to_year: int
    amount: float
    currency: str = "INR"
    change_reason: Optional[str] = None


class MembershipTypePriceUpdate(BaseModel):
    amount: Optional[float] = None
    currency: Optional[str] = None
    effective_from: Optional[date_type] = None
    effective_to: Optional[date_type] = None
    change_reason: Optional[str] = None


class MembershipTypePrice(MembershipTypePriceBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MembershipTypeWithPrice(MembershipType):
    current_price: Optional[float] = None
    current_price_id: Optional[int] = None


class DocumentTypeBase(BaseModel):
    code: Optional[str] = None
    name_en: str
    name_kn: Optional[str] = None
    is_required: bool = False
    status: bool = True


class DocumentTypeCreate(_AutoCode, DocumentTypeBase):
    pass


class DocumentTypeUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    is_required: Optional[bool] = None
    status: Optional[bool] = None


class DocumentType(DocumentTypeBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)



class ParticularBase(BaseModel):
    code: Optional[str] = None
    name_en: str
    name_kn: Optional[str] = None
    parent_id: Optional[int] = None
    service_type_id: Optional[int] = None
    status: bool = True
    pays_for_membership: bool = False  # main particulars only (a sub type follows its main particular)
    needs_description: bool = False

class ParticularCreate(_AutoCode, ParticularBase):
    pass

class ParticularUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    parent_id: Optional[int] = None
    service_type_id: Optional[int] = None
    status: Optional[bool] = None
    pays_for_membership: Optional[bool] = None
    needs_description: Optional[bool] = None

class Particular(ParticularBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ServiceTypeBase(BaseModel):
    code: Optional[str] = None
    name_en: str
    name_kn: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    status: bool = True


class ServiceTypeCreate(_AutoCode, ServiceTypeBase):
    pass


class ServiceTypeUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    status: Optional[bool] = None


class ServiceType(ServiceTypeBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class BankBase(BaseModel):
    code: Optional[str] = None
    name_en: str
    name_kn: Optional[str] = None
    account_number: Optional[str] = None
    branch_name: Optional[str] = None
    ifsc_code: Optional[str] = None
    description: Optional[str] = None
    status: bool = True


class BankCreate(_AutoCode, BankBase):
    pass


class BankUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    account_number: Optional[str] = None
    branch_name: Optional[str] = None
    ifsc_code: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None


class Bank(BankBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PaymentModeBase(BaseModel):
    payment_mode: str
    payment_type: str
    bank_id: Optional[int] = None
    status: bool = True

class PaymentModeCreate(PaymentModeBase):
    pass

class PaymentModeUpdate(BaseModel):
    payment_mode: Optional[str] = None
    payment_type: Optional[str] = None
    bank_id: Optional[int] = None
    status: Optional[bool] = None

class PaymentMode(PaymentModeBase):
    id: int
    created_at: datetime
    bank: Optional[Bank] = None
    model_config = ConfigDict(from_attributes=True)


class HmsSettingBase(BaseModel):
    setting_key: str
    setting_value: dict
    data_type: str
    description: Optional[str] = None


class HmsSettingCreate(HmsSettingBase):
    pass


class HmsSettingUpdate(BaseModel):
    setting_value: Optional[dict] = None
    data_type: Optional[str] = None
    description: Optional[str] = None


class HmsSetting(HmsSettingBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ─── Mangalya-parity personal masters (gotra, nakshatra, …) ───

class PersonalMasterBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    status: bool = True

class PersonalMasterCreate(PersonalMasterBase):
    pass

class PersonalMasterUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    status: Optional[bool] = None

class PersonalMaster(PersonalMasterBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NativePlaceCreate(PersonalMasterBase):
    district_id: Optional[int] = None

class NativePlaceUpdate(PersonalMasterUpdate):
    district_id: Optional[int] = None

class NativePlace(PersonalMaster):
    district_id: Optional[int] = None


# ─── Deletion reason master (Mangalya parity: delete_reason) ───

class DeletionReasonBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    applies_to: Optional[str] = None  # SOFT | PERMANENT | None (= both)
    status: bool = True


class DeletionReasonCreate(DeletionReasonBase):
    pass


class DeletionReasonUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    applies_to: Optional[str] = None
    status: Optional[bool] = None


class DeletionReason(DeletionReasonBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
