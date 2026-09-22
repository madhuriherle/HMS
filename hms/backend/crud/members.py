from crud.base import CRUDBase
from models.members import Member, MemberMembership, MemberDocument, MemberProfileChangeRequest
from schemas.members import (
    MemberCreate, MemberUpdate, MemberMembershipCreate, MemberMembershipUpdate,
    MemberDocumentCreate, MemberDocumentUpdate, MemberProfileChangeRequestCreate, MemberProfileChangeRequestUpdate
)
from sqlalchemy.orm import Session
from datetime import datetime

class CRUDMember(CRUDBase[Member, MemberCreate, MemberUpdate]):
    def approve_member(self, db: Session, *, db_obj: Member, approved_by: int) -> Member:
        setattr(db_obj, "approval_status", "APPROVED")
        setattr(db_obj, "approved_by", approved_by)
        setattr(db_obj, "approved_at", datetime.now())
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

class CRUDMemberMembership(CRUDBase[MemberMembership, MemberMembershipCreate, MemberMembershipUpdate]):
    pass

class CRUDMemberDocument(CRUDBase[MemberDocument, MemberDocumentCreate, MemberDocumentUpdate]):
    pass

class CRUDMemberProfileChangeRequest(CRUDBase[MemberProfileChangeRequest, MemberProfileChangeRequestCreate, MemberProfileChangeRequestUpdate]):
    pass

member = CRUDMember(Member)
membership = CRUDMemberMembership(MemberMembership)
document = CRUDMemberDocument(MemberDocument)
profile_change = CRUDMemberProfileChangeRequest(MemberProfileChangeRequest)
