from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class AffiliationBase(BaseModel):
    group_name: str
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None
    magazine_enabled: bool = True

class AffiliationCreate(AffiliationBase):
    pass

class AffiliationUpdate(BaseModel):
    group_name: Optional[str] = None
    magazine_enabled: Optional[bool] = None

class Affiliation(AffiliationBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class Associate(BaseModel):
    id: int
    name: str
    organization: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: bool = True
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class PressMedia(BaseModel):
    id: int
    organization_name: str
    reporter_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: bool = True
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class CommitteeCategory(BaseModel):
    id: int
    name_en: str
    name_kn: Optional[str] = None
    display_on_website: bool = True
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class CommitteeTerm(BaseModel):
    id: int
    term_name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: bool = False
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class CommitteeMember(BaseModel):
    id: int
    category_id: int
    subcategory_id: Optional[int] = None
    term_id: Optional[int] = None
    member_name: str
    designation: Optional[str] = None
    display_on_website: bool = True
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
