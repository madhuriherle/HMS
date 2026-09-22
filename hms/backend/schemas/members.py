from typing import Optional, Set
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, field_validator

# Fields a member may propose changing themselves (profile/KYC flows).
# Anything outside this set (approval_status, member_code, is_deleted, …)
# must never be updatable through a change request.
EDITABLE_MEMBER_FIELDS: Set[str] = {
    "mobile", "mobile_country_code", "alternate_mobile", "email",
    "address_line1", "address_line2", "locality",
    "address_line1_kn", "address_line2_kn", "locality_kn",
    "full_name_kn", "gender", "date_of_birth",
    "state_id", "district_id", "taluk_id", "pincode_id",
}

class MemberBase(BaseModel):
    first_name_en: str
    middle_name_en: Optional[str] = None
    last_name_en: Optional[str] = None
    full_name_kn: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    mobile: Optional[str] = None
    mobile_country_code: str = "+91"
    email: Optional[str] = None
    
    address_line1: Optional[str] = None
    locality: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    taluk_id: Optional[int] = None
    pincode_id: Optional[int] = None
    
    registration_source: str = "ONLINE"

class MemberCreate(MemberBase):
    pass

class MemberUpdate(BaseModel):
    first_name_en: Optional[str] = None
    approval_status: Optional[str] = None
    member_status: Optional[str] = None

class MemberInDBBase(MemberBase):
    id: int
    member_code: Optional[str] = None
    registration_status: str
    approval_status: str
    member_status: str
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class Member(MemberInDBBase):
    pass

class MemberMembershipBase(BaseModel):
    member_id: int
    membership_type_id: int
    membership_number: Optional[str] = None
    status: str = "ACTIVE"

class MemberMembershipCreate(MemberMembershipBase):
    pass

class MemberMembershipUpdate(BaseModel):
    status: Optional[str] = None
    membership_number: Optional[str] = None

class MemberMembership(MemberMembershipBase):
    id: int
    applied_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MemberDocumentBase(BaseModel):
    member_id: int
    document_type_id: int
    file_path: str
    original_filename: str

class MemberDocumentCreate(MemberDocumentBase):
    pass

class MemberDocumentUpdate(BaseModel):
    verification_status: Optional[str] = None

class MemberDocument(MemberDocumentBase):
    id: int
    verification_status: str
    model_config = ConfigDict(from_attributes=True)

class MemberProfileChangeRequestBase(BaseModel):
    member_id: int
    new_values: dict

    @field_validator("new_values")
    @classmethod
    def _restrict_fields(cls, values: dict) -> dict:
        unknown = sorted(set(values) - EDITABLE_MEMBER_FIELDS)
        if unknown:
            raise ValueError(
                f"Fields not allowed in a change request: {', '.join(unknown)}"
            )
        if not values:
            raise ValueError("new_values must contain at least one field")
        return values

class MemberProfileChangeRequestCreate(MemberProfileChangeRequestBase):
    pass

class MembershipCreate(BaseModel):
    """Body for POST /members/{id}/memberships — member comes from the path."""
    membership_type_id: int
    status: str = "ACTIVE"

class MemberProfileChangeRequestUpdate(BaseModel):
    status: Optional[str] = None
    review_note: Optional[str] = None

class MemberProfileChangeRequest(MemberProfileChangeRequestBase):
    id: int
    status: str
    model_config = ConfigDict(from_attributes=True)
