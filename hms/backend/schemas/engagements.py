from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class AffiliationBase(BaseModel):
    group_name: str
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: bool = True

class AffiliationCreate(AffiliationBase):
    pass

class AffiliationUpdate(BaseModel):
    group_name: Optional[str] = None
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: Optional[bool] = None

class Affiliation(AffiliationBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class AssociateBase(BaseModel):
    name: str
    organization: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: bool = True

class AssociateCreate(AssociateBase):
    pass

class AssociateUpdate(BaseModel):
    name: Optional[str] = None
    organization: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: Optional[bool] = None

class Associate(AssociateBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class PressMediaBase(BaseModel):
    organization_name: str
    reporter_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: bool = True

class PressMediaCreate(PressMediaBase):
    pass

class PressMediaUpdate(BaseModel):
    organization_name: Optional[str] = None
    reporter_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    magazine_enabled: Optional[bool] = None

class PressMedia(PressMediaBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AffiliationContactBase(BaseModel):
    name: str
    mobile: Optional[str] = None
    email: Optional[str] = None
    designation: Optional[str] = None

class AffiliationContactCreate(AffiliationContactBase):
    pass

class AffiliationContact(AffiliationContactBase):
    id: int
    affiliation_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class CommitteeCategoryBase(BaseModel):
    name_en: str
    name_kn: Optional[str] = None
    display_on_website: bool = True

class CommitteeCategoryCreate(CommitteeCategoryBase):
    pass

class CommitteeCategoryUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    display_on_website: Optional[bool] = None

class CommitteeCategory(CommitteeCategoryBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CommitteeSubcategoryBase(BaseModel):
    category_id: int
    name_en: str
    name_kn: Optional[str] = None
    display_on_website: bool = True

class CommitteeSubcategoryCreate(CommitteeSubcategoryBase):
    pass

class CommitteeSubcategoryUpdate(BaseModel):
    category_id: Optional[int] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    display_on_website: Optional[bool] = None

class CommitteeSubcategory(CommitteeSubcategoryBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CommitteeTermBase(BaseModel):
    term_name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: bool = False

class CommitteeTermCreate(CommitteeTermBase):
    pass

class CommitteeTermUpdate(BaseModel):
    term_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: Optional[bool] = None

class CommitteeTerm(CommitteeTermBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CommitteeMemberBase(BaseModel):
    category_id: int
    subcategory_id: Optional[int] = None
    term_id: Optional[int] = None
    member_name: str
    designation: Optional[str] = None
    display_on_website: bool = True
    hms_member_id: Optional[int] = None

class CommitteeMemberCreate(CommitteeMemberBase):
    pass

class CommitteeMemberUpdate(BaseModel):
    category_id: Optional[int] = None
    subcategory_id: Optional[int] = None
    term_id: Optional[int] = None
    member_name: Optional[str] = None
    designation: Optional[str] = None
    display_on_website: Optional[bool] = None
    hms_member_id: Optional[int] = None

class CommitteeMember(CommitteeMemberBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
