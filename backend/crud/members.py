from crud.base import CRUDBase
from models.members import (
    Member, MemberMembership, MemberDocument, MemberProfileChangeRequest, MemberServiceOptin
)
from schemas.members import (
    MemberCreate, MemberUpdate, MemberMembershipCreate, MemberMembershipUpdate,
    MemberDocumentCreate, MemberDocumentUpdate, MemberProfileChangeRequestCreate, MemberProfileChangeRequestUpdate,
    MemberServiceOptinCreate, MemberServiceOptinUpdate
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

class CRUDMemberServiceOptin(CRUDBase[MemberServiceOptin, MemberServiceOptinCreate, MemberServiceOptinUpdate]):
    def get_active(self, db: Session, *, member_id: int, service_type_id: int) -> MemberServiceOptin:
        """The member's live opt-in for one service, or None. Used to enforce
        one-active-opt-in before inserting and to find the row to re-open when
        a cancelled opt-in is reinstated."""
        return db.query(MemberServiceOptin).filter(
            MemberServiceOptin.member_id == member_id,
            MemberServiceOptin.service_type_id == service_type_id,
            MemberServiceOptin.is_deleted == False,  # noqa: E712
        ).first()

member = CRUDMember(Member)
membership = CRUDMemberMembership(MemberMembership)
document = CRUDMemberDocument(MemberDocument)
profile_change = CRUDMemberProfileChangeRequest(MemberProfileChangeRequest)
service_optin = CRUDMemberServiceOptin(MemberServiceOptin)
