from crud.base import CRUDBase
from models.masters import (
    State, District, Taluk, PostalCode, MembershipType, MembershipTypePrice,
    DocumentType, ServiceType, HmsSetting,
    Qualification, NativePlace, Gotra,
    DeletionReason,
)
from schemas.masters import (
    StateCreate, StateUpdate, DistrictCreate, DistrictUpdate, 
    TalukCreate, TalukUpdate, PostalCodeCreate, PostalCodeUpdate,
    MembershipTypeCreate, MembershipTypeUpdate, MembershipTypePriceCreate, MembershipTypePriceUpdate,
    DocumentTypeCreate, DocumentTypeUpdate,
    ServiceTypeCreate, ServiceTypeUpdate, HmsSettingCreate, HmsSettingUpdate,
    PersonalMasterCreate, PersonalMasterUpdate,
    NativePlaceCreate, NativePlaceUpdate,
    DeletionReasonCreate, DeletionReasonUpdate,
)

class CRUDState(CRUDBase[State, StateCreate, StateUpdate]):
    pass

class CRUDDistrict(CRUDBase[District, DistrictCreate, DistrictUpdate]):
    pass

class CRUDTaluk(CRUDBase[Taluk, TalukCreate, TalukUpdate]):
    pass

class CRUDPostalCode(CRUDBase[PostalCode, PostalCodeCreate, PostalCodeUpdate]):
    pass

class CRUDMembershipType(CRUDBase[MembershipType, MembershipTypeCreate, MembershipTypeUpdate]):
    pass

class CRUDMembershipTypePrice(CRUDBase[MembershipTypePrice, MembershipTypePriceCreate, MembershipTypePriceUpdate]):
    pass

class CRUDDocumentType(CRUDBase[DocumentType, DocumentTypeCreate, DocumentTypeUpdate]):
    pass

class CRUDServiceType(CRUDBase[ServiceType, ServiceTypeCreate, ServiceTypeUpdate]):
    pass

class CRUDHmsSetting(CRUDBase[HmsSetting, HmsSettingCreate, HmsSettingUpdate]):
    pass

state = CRUDState(State)
district = CRUDDistrict(District)
taluk = CRUDTaluk(Taluk)
postal_code = CRUDPostalCode(PostalCode)
membership_type = CRUDMembershipType(MembershipType)
membership_type_price = CRUDMembershipTypePrice(MembershipTypePrice)
document_type = CRUDDocumentType(DocumentType)
service_type = CRUDServiceType(ServiceType)
hms_setting = CRUDHmsSetting(HmsSetting)

# ─── Personal masters ───
class CRUDPersonalMaster(CRUDBase):
    """Generic CRUD for the simple id+name(+kn)+status masters."""
    pass

class CRUDNativePlace(CRUDBase[NativePlace, NativePlaceCreate, NativePlaceUpdate]):
    pass

qualification = CRUDPersonalMaster(Qualification)
gotra = CRUDPersonalMaster(Gotra)
native_place = CRUDNativePlace(NativePlace)

class CRUDDeletionReason(CRUDBase[DeletionReason, DeletionReasonCreate, DeletionReasonUpdate]):
    pass

deletion_reason = CRUDDeletionReason(DeletionReason)
