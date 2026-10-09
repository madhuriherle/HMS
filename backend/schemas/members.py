from typing import List, Optional, Set
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Fields a member may propose changing themselves (profile/KYC flows).
# Anything outside this set (approval_status, member_code, is_deleted, …)
# must never be updatable through a change request.
EDITABLE_MEMBER_FIELDS: Set[str] = {
    "mobile", "mobile_country_code", "alternate_mobile", "whatsapp_number", "email",
    "address_line1", "address_line2", "locality",
    "address_line1_kn", "address_line2_kn", "locality_kn",
    "full_name_kn", "gender", "date_of_birth",
    "father_husband_name", "blood_group", "native_place_id",
    "native_place_text", "qualification_id", "qualification_text", "occupation",
    "gotra_id", "gotra_text",
    "father_name", "father_membership_number", "mother_name", "mother_membership_number",
    "is_married", "spouse_name", "spouse_membership_number", "has_children", "children_details",
    "area", "place", "grama", "village", "label_point", "address_remarks",
    "country", "city", "post", "category", "company", "website", "remarks",

    "aadhaar_number", "referred_by_member_id",
    "state_id", "district_id", "taluk_id", "pincode_id",
}

VALID_GENDERS = {"MALE", "FEMALE", "OTHER"}

VALID_SERVICE_OPTIN_STATUSES = {"ACTIVE", "CANCELLED"}
VALID_SERVICE_OPTIN_SOURCES = {"ADMIN", "MOBILE_APP", "WEBSITE"}


class MemberBase(BaseModel):
    first_name_en: str
    middle_name_en: Optional[str] = None
    last_name_en: Optional[str] = None
    full_name_kn: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    # Mangalya-parity personal fields.
    father_husband_name: Optional[str] = None
    blood_group: Optional[str] = None
    native_place_id: Optional[int] = None
    native_place_text: Optional[str] = None
    qualification_id: Optional[int] = None
    qualification_text: Optional[str] = None
    gotra_id: Optional[int] = None
    gotra_text: Optional[str] = None
    occupation: Optional[str] = None
    category: Optional[str] = None
    company: Optional[str] = None
    website: Optional[str] = None
    remarks: Optional[str] = None
    aadhaar_number: Optional[str] = None
    whatsapp_number: Optional[str] = None
    referred_by_member_id: Optional[int] = None

    father_name: Optional[str] = None
    father_membership_number: Optional[str] = None
    mother_name: Optional[str] = None
    mother_membership_number: Optional[str] = None
    is_married: Optional[bool] = None
    spouse_name: Optional[str] = None
    spouse_membership_number: Optional[str] = None
    has_children: Optional[bool] = None
    children_details: Optional[list] = None

    mobile: Optional[str] = None
    mobile_country_code: str = "+91"
    alternate_mobile: Optional[str] = None
    email: Optional[str] = None

    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    locality: Optional[str] = None
    country: Optional[str] = "India"
    city: Optional[str] = None
    post: Optional[str] = None
    area: Optional[str] = None
    place: Optional[str] = None
    grama: Optional[str] = None
    village: Optional[str] = None
    label_point: Optional[str] = None
    address_remarks: Optional[str] = None
    address_line1_kn: Optional[str] = None
    address_line2_kn: Optional[str] = None
    locality_kn: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    taluk_id: Optional[int] = None
    pincode_id: Optional[int] = None

    registration_source: str = "ONLINE"

    @field_validator("whatsapp_number", "alternate_mobile")
    @classmethod
    def _validate_whatsapp(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.isdigit() or not (10 <= len(v) <= 12):
            raise ValueError("whatsapp_number must be 10-12 digits")
        return v

    @field_validator("gender")
    @classmethod
    def _validate_gender(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_GENDERS:
            raise ValueError(f"gender must be one of: {', '.join(sorted(VALID_GENDERS))}")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def _validate_dob(cls, v: Optional[date]) -> Optional[date]:
        if v:
            today = date.today()
            age = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
            if age < 18:
                raise ValueError("Member must be at least 18 years old")
        return v

    @field_validator("mobile", "alternate_mobile")
    @classmethod
    def _validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.isdigit() or not (10 <= len(v) <= 12):
            raise ValueError("mobile must be 10-12 digits")
        return v


class MemberCreate(MemberBase):
    pass


class MemberUpdate(BaseModel):
    """Admin edit — every column is editable except identity/status fields
    that have dedicated flows (member_code via approval, statuses via
    approve/activate endpoints)."""
    first_name_en: Optional[str] = None
    middle_name_en: Optional[str] = None
    last_name_en: Optional[str] = None
    full_name_kn: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    # Mangalya-parity personal fields.
    father_husband_name: Optional[str] = None
    blood_group: Optional[str] = None
    native_place_id: Optional[int] = None
    native_place_text: Optional[str] = None
    qualification_id: Optional[int] = None
    qualification_text: Optional[str] = None
    gotra_id: Optional[int] = None
    gotra_text: Optional[str] = None
    occupation: Optional[str] = None
    category: Optional[str] = None
    company: Optional[str] = None
    website: Optional[str] = None
    remarks: Optional[str] = None
    aadhaar_number: Optional[str] = None
    whatsapp_number: Optional[str] = None
    referred_by_member_id: Optional[int] = None

    father_name: Optional[str] = None
    father_membership_number: Optional[str] = None
    mother_name: Optional[str] = None
    mother_membership_number: Optional[str] = None
    is_married: Optional[bool] = None
    spouse_name: Optional[str] = None
    spouse_membership_number: Optional[str] = None
    has_children: Optional[bool] = None
    children_details: Optional[list] = None

    mobile: Optional[str] = None
    mobile_country_code: Optional[str] = None
    alternate_mobile: Optional[str] = None
    email: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    locality: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    post: Optional[str] = None
    area: Optional[str] = None
    place: Optional[str] = None
    grama: Optional[str] = None
    village: Optional[str] = None
    label_point: Optional[str] = None
    address_remarks: Optional[str] = None
    address_line1_kn: Optional[str] = None
    address_line2_kn: Optional[str] = None
    locality_kn: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    taluk_id: Optional[int] = None
    pincode_id: Optional[int] = None
    # Active/Inactive toggle only; approval state has its own flow.
    member_status: Optional[str] = None

    @field_validator("member_status")
    @classmethod
    def _validate_member_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().upper()
        if v not in ("ACTIVE", "INACTIVE"):
            raise ValueError("member_status must be ACTIVE or INACTIVE")
        return v

    @field_validator("gender")
    @classmethod
    def _validate_gender(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_GENDERS:
            raise ValueError(f"gender must be one of: {', '.join(sorted(VALID_GENDERS))}")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def _validate_dob(cls, v: Optional[date]) -> Optional[date]:
        if v:
            today = date.today()
            age = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
            if age < 18:
                raise ValueError("Member must be at least 18 years old")
        return v

    @field_validator("mobile", "alternate_mobile")
    @classmethod
    def _validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.isdigit() or not (10 <= len(v) <= 12):
            raise ValueError("mobile must be 10-12 digits")
        return v


class MemberInDBBase(MemberBase):
    id: int
    member_code: Optional[str] = None
    registration_status: str
    approval_status: str
    member_status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MemberFamilyLink(BaseModel):
    id: int
    member_code: Optional[str] = None
    name: str
    relationship: str
    
    model_config = ConfigDict(from_attributes=True)

class MemberDonation(BaseModel):
    receipt_id: int
    receipt_number: str
    receipt_date: date
    amount: float
    purpose: str

    model_config = ConfigDict(from_attributes=True)

class Member(MemberInDBBase):
    pass


class MemberMembershipBase(BaseModel):
    member_id: int
    membership_type_id: int
    membership_number: Optional[str] = None
    family_membership_number: Optional[str] = None
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


class MemberServiceOptinBase(BaseModel):
    """Body for POST /members/{id}/service-optins — member_id comes from the path."""

    service_type_id: int
    status: str = "ACTIVE"
    opted_via: str = "ADMIN"
    linked_type: Optional[str] = None
    linked_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_SERVICE_OPTIN_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(sorted(VALID_SERVICE_OPTIN_STATUSES))}")
        return v

    @field_validator("opted_via")
    @classmethod
    def _validate_opted_via(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_SERVICE_OPTIN_SOURCES:
            raise ValueError(f"opted_via must be one of: {', '.join(sorted(VALID_SERVICE_OPTIN_SOURCES))}")
        return v

    @model_validator(mode="after")
    def _validate_link_pair(self):
        # linked_type names the dedicated table, linked_id the row in it —
        # half a pair is always a bug, never a default.
        if (self.linked_type is None) != (self.linked_id is None):
            raise ValueError("linked_type and linked_id must be provided together")
        return self


class MemberServiceOptinCreate(MemberServiceOptinBase):
    pass


class MemberServiceOptinUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    linked_type: Optional[str] = None
    linked_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_SERVICE_OPTIN_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(sorted(VALID_SERVICE_OPTIN_STATUSES))}")
        return v

    @model_validator(mode="after")
    def _validate_link_pair(self):
        if (self.linked_type is None) != (self.linked_id is None):
            raise ValueError("linked_type and linked_id must be provided together")
        return self


class MemberServiceOptin(MemberServiceOptinBase):
    id: int
    member_id: int
    opted_at: datetime
    # Resolved from service_types for display on the profile screen.
    service_code: Optional[str] = None
    service_name_en: Optional[str] = None
    service_name_kn: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class BulkServiceOptin(BaseModel):
    """Body for POST /members/{id}/service-optins/bulk — the registration
    form's checkbox group applied as one set."""

    opt_in: List[int] = Field(default_factory=list)
    opt_out: List[int] = Field(default_factory=list)
    opted_via: Optional[str] = None

    @field_validator("opted_via")
    @classmethod
    def _validate_opted_via(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if v not in VALID_SERVICE_OPTIN_SOURCES:
            raise ValueError(f"opted_via must be one of: {', '.join(sorted(VALID_SERVICE_OPTIN_SOURCES))}")
        return v

    @field_validator("opt_in", "opt_out")
    @classmethod
    def _validate_dedupe(cls, v: List[int]) -> List[int]:
        if len(set(v)) != len(v):
            raise ValueError("service ids must not repeat")
        return v

    @model_validator(mode="after")
    def _validate_no_overlap(self):
        both = set(self.opt_in) & set(self.opt_out)
        if both:
            raise ValueError(
                f"service ids cannot be in both opt_in and opt_out: {sorted(both)}"
            )
        return self


class BulkServiceOptinResult(BaseModel):
    """Response of POST /members/{id}/service-optins/bulk — the service_type_ids
    newly added, the ones whose status flipped, and the member's full opt-in
    list afterwards, so the caller renders from one response."""

    member_id: int
    opted_in: List[int] = Field(default_factory=list)
    changed: List[int] = Field(default_factory=list)
    data: List[MemberServiceOptin] = Field(default_factory=list)


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
    family_membership_number: Optional[str] = None


class MemberProfileChangeRequestUpdate(BaseModel):
    status: Optional[str] = None
    review_note: Optional[str] = None


class MemberProfileChangeRequest(MemberProfileChangeRequestBase):
    id: int
    status: str
    model_config = ConfigDict(from_attributes=True)
