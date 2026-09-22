from typing import Optional, List
from datetime import date as date_type, datetime
from pydantic import BaseModel, ConfigDict, field_validator

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
    code: str
    name_en: str
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: bool = True


class MembershipTypeCreate(MembershipTypeBase):
    pass


class MembershipTypeUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None


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
    code: str
    name_en: str
    name_kn: Optional[str] = None
    is_required: bool = False
    status: bool = True


class DocumentTypeCreate(DocumentTypeBase):
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


class ServiceTypeBase(BaseModel):
    code: str
    name_en: str
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: bool = True


class ServiceTypeCreate(ServiceTypeBase):
    pass


class ServiceTypeUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None


class ServiceType(ServiceTypeBase):
    id: int
    created_at: datetime
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
