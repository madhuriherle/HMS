from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict

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
