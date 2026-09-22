from crud.base import CRUDBase
from models.masters import State, District, Taluk, PostalCode, MembershipType, DocumentType, ServiceType, HmsSetting
from schemas.masters import (
    StateCreate, StateUpdate, DistrictCreate, DistrictUpdate, 
    TalukCreate, TalukUpdate, PostalCodeCreate, PostalCodeUpdate,
    MembershipTypeCreate, MembershipTypeUpdate, DocumentTypeCreate, DocumentTypeUpdate,
    ServiceTypeCreate, ServiceTypeUpdate, HmsSettingCreate, HmsSettingUpdate
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
document_type = CRUDDocumentType(DocumentType)
service_type = CRUDServiceType(ServiceType)
hms_setting = CRUDHmsSetting(HmsSetting)
