from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_
from crud import members as crud_members
from schemas import members as schemas_members
from api import deps
from models.members import Member, MemberApprovalHistory, MemberMembership
from models.users import User
from core.pagination import paginate
from services.sequences import generate_next_number
from services.pricing import active_price
from services.file_upload import save_upload
from datetime import datetime, timezone

router = APIRouter()

@router.get("/")
def read_members(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
    # Filters
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    pincode_id: Optional[int] = None,
    gender: Optional[str] = None,
    approval_status: Optional[str] = None,
    member_status: Optional[str] = None,
    membership_type_id: Optional[int] = None,
    registration_source: Optional[str] = None,
    include_deleted: bool = False,
    search: Optional[str] = None,
) -> Any:
    """Retrieve members with optional filters and search (offline + online)."""
    query = db.query(Member).filter(Member.is_deleted == False)
    if include_deleted:
        query = db.query(Member)

    if state_id:
        query = query.filter(Member.state_id == state_id)
    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)
    if pincode_id:
        query = query.filter(Member.pincode_id == pincode_id)
    if gender:
        query = query.filter(Member.gender == gender)
    if approval_status:
        query = query.filter(Member.approval_status == approval_status)
    if member_status:
        query = query.filter(Member.member_status == member_status)
    if registration_source:
        query = query.filter(Member.registration_source == registration_source)
    if membership_type_id:
        query = query.join(
            MemberMembership, MemberMembership.member_id == Member.id
        ).filter(
            MemberMembership.membership_type_id == membership_type_id,
            MemberMembership.is_deleted == False,
        ).distinct()
    if search:
        query = query.filter(or_(
            Member.first_name_en.ilike(f"%{search}%"),
            Member.last_name_en.ilike(f"%{search}%"),
            Member.full_name_kn.ilike(f"%{search}%"),
            Member.mobile.ilike(f"%{search}%"),
            Member.alternate_mobile.ilike(f"%{search}%"),
            Member.member_code.ilike(f"%{search}%"),
            Member.email.ilike(f"%{search}%"),
        ))

    return paginate(query, page, limit)


@router.post("/", response_model=schemas_members.Member, status_code=201)
def create_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    member_in: schemas_members.MemberCreate,
) -> Any:
    """Register a member (offline form or website) with duplicate validation.

    A MEMBER-type login account is provisioned automatically so the member
    can use the mobile app; their username is the mobile number when given.
    """
    from core.security import get_password_hash
    from models.users import User as UserModel
    from models.members import Member as MemberModel

    # ── Duplicate validation ──
    if member_in.mobile:
        existing = db.query(MemberModel).filter(
            MemberModel.mobile == member_in.mobile,
            MemberModel.is_deleted == False,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Duplicate: member with mobile {member_in.mobile} already "
                    f"exists (ID: {existing.id}, code: {existing.member_code})"
                ),
            )
    if member_in.full_name_kn:
        existing_kn = db.query(MemberModel).filter(
            MemberModel.full_name_kn == member_in.full_name_kn,
            MemberModel.date_of_birth == member_in.date_of_birth,
            MemberModel.is_deleted == False,
        ).first()
        if existing_kn:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Duplicate: member with Kannada name '{member_in.full_name_kn}' "
                    f"and same date of birth already exists (ID: {existing_kn.id})"
                ),
            )

    # ── Geography cross-checks ──
    if member_in.pincode_id:
        from models.masters import PostalCode
        pc = db.query(PostalCode).filter(PostalCode.id == member_in.pincode_id).first()
        if not pc:
            raise HTTPException(status_code=400, detail="Invalid pincode_id")
        # Auto-fill geography from the postal code record when not supplied.
        if not member_in.state_id:
            member_in.state_id = pc.state_id
        if not member_in.district_id:
            member_in.district_id = pc.district_id
        if not member_in.taluk_id and pc.taluk_id:
            member_in.taluk_id = pc.taluk_id
    if member_in.state_id:
        from models.masters import State
        if not db.query(State).filter(State.id == member_in.state_id).first():
            raise HTTPException(status_code=400, detail="Invalid state_id")
    if member_in.district_id:
        from models.masters import District
        district = db.query(District).filter(District.id == member_in.district_id).first()
        if not district:
            raise HTTPException(status_code=400, detail="Invalid district_id")
        if member_in.state_id and district.state_id != member_in.state_id:
            raise HTTPException(status_code=400, detail="district_id does not belong to state_id")
    if member_in.taluk_id:
        from models.masters import Taluk
        taluk = db.query(Taluk).filter(Taluk.id == member_in.taluk_id).first()
        if not taluk:
            raise HTTPException(status_code=400, detail="Invalid taluk_id")
        if member_in.district_id and taluk.district_id != member_in.district_id:
            raise HTTPException(status_code=400, detail="taluk_id does not belong to district_id")

    db_obj = MemberModel(**member_in.model_dump(), created_by=current_user.id)
    db.add(db_obj)
    db.flush()

    # ── Provision the member's login account (spec: 'a user with a membership
    # role will be created'). Uses mobile as username; skip silently when the
    # username is taken (member accounts can also be created later).
    login_username = member_in.mobile or f"member{db_obj.id}"
    if not db.query(UserModel).filter(UserModel.username == login_username).first():
        import secrets
        temp_password = secrets.token_urlsafe(12)
        db.add(UserModel(
            name=f"{member_in.first_name_en} {member_in.last_name_en or ''}".strip(),
            username=login_username,
            mobile=member_in.mobile,
            password_hash=get_password_hash(temp_password),
            user_type="MEMBER",
            member_id=db_obj.id,
            created_by=current_user.id,
        ))

    db.commit()
    db.refresh(db_obj)
    return db_obj

@router.get("/{id}", response_model=schemas_members.Member)
def read_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return member

@router.put("/{id}", response_model=schemas_members.Member)
def update_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
    member_in: schemas_members.MemberUpdate,
) -> Any:
    """Admin edit of a member profile (all personal + address fields)."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    data = member_in.model_dump(exclude_unset=True)

    # Mobile changes must not collide with another active member.
    if "mobile" in data and data["mobile"] and data["mobile"] != member.mobile:
        clash = db.query(Member).filter(
            Member.mobile == data["mobile"],
            Member.is_deleted == False,
            Member.id != id,
        ).first()
        if clash:
            raise HTTPException(409, f"Mobile {data['mobile']} belongs to another member (ID: {clash.id})")

    # Geography references must stay consistent.
    if data.get("pincode_id"):
        from models.masters import PostalCode
        if not db.query(PostalCode).filter(PostalCode.id == data["pincode_id"]).first():
            raise HTTPException(400, "Invalid pincode_id")
    if data.get("district_id"):
        from models.masters import District
        if not db.query(District).filter(District.id == data["district_id"]).first():
            raise HTTPException(400, "Invalid district_id")
    if data.get("taluk_id") and data.get("district_id", member.district_id):
        from models.masters import Taluk
        taluk = db.query(Taluk).filter(Taluk.id == data["taluk_id"]).first()
        if not taluk:
            raise HTTPException(400, "Invalid taluk_id")
        if taluk.district_id != data.get("district_id", member.district_id):
            raise HTTPException(400, "taluk_id does not belong to district_id")

    return crud_members.member.update(db=db, db_obj=member, obj_in=data, updated_by=current_user.id)

@router.put("/{id}/approve", response_model=schemas_members.Member)
def approve_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    background_tasks: BackgroundTasks,
    id: int,
) -> Any:
    """Approve a member and auto-assign membership number."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    now = datetime.now(timezone.utc)
    old_status = member.approval_status

    # Auto-generate member_code
    if not member.member_code:
        member.member_code = generate_next_number(db, "MEMBER_CODE", "HMS")
    member.approval_status = "APPROVED"
    member.approved_by = current_user.id
    member.approved_at = now
    db.add(MemberApprovalHistory(
        member_id=member.id,
        action="APPROVE",
        old_status=old_status,
        new_status="APPROVED",
        acted_by=current_user.id,
        acted_at=now,
        created_by=current_user.id,
    ))

    # Spec: activation assigns the permanent membership number to the member's
    # membership rows (numbers are minted by the sequence generator).
    memberships = (
        db.query(MemberMembership)
        .filter(
            MemberMembership.member_id == member.id,
            MemberMembership.is_deleted == False,
            MemberMembership.membership_number == None,
        )
        .all()
    )
    for membership in memberships:
        membership.membership_number = generate_next_number(db, "MEMBERSHIP_NO", "HMSM")
        membership.activated_at = now
        membership.updated_by = current_user.id

    db.commit()
    db.refresh(member)

    # Spec: notification on membership activation (template based). The
    # MEMBERSHIP_ACTIVATION template is looked up by purpose; approval must
    # not fail when it is missing or the member has no mobile number.
    _queue_activation_notification(db, background_tasks, member, activated_by=current_user.id)
    return member


def _queue_activation_notification(
    db: Session, background_tasks: BackgroundTasks, member: Member, *, activated_by: int
) -> None:
    """Queue the membership-activation WhatsApp for a member (fire and forget)."""
    from models.notifications import NotificationTemplate
    from services.template_renderer import render

    template = db.query(NotificationTemplate).filter(
        NotificationTemplate.purpose == "MEMBERSHIP_ACTIVATION",
        NotificationTemplate.status == True,  # noqa: E712
        NotificationTemplate.is_deleted == False,
    ).first()
    if not template or not member.mobile:
        return

    variables = {
        "name": " ".join(p for p in (member.first_name_en, member.last_name_en) if p),
        "full_name_kn": member.full_name_kn or "",
        "member_code": member.member_code or "",
        "mobile": member.mobile or "",
    }
    content = render(template.content, variables)
    to_number = f"{member.mobile_country_code}{member.mobile}"
    provider_template_id = template.provider_template_id
    member_id = member.id
    member_mobile = member.mobile

    async def _send():
        from db.session import SessionLocal
        from models.notifications import NotificationMessage

        status, response = "FAILED", None
        try:
            from services.whatsapp import whatsapp_service
            response = await whatsapp_service.send_message(
                to=to_number, message=content, template_id=provider_template_id
            )
            status = "SENT"
        except Exception as exc:
            response = {"error": str(exc)}

        session = SessionLocal()
        try:
            session.add(NotificationMessage(
                member_id=member_id,
                recipient_number=member_mobile,
                message_content=content,
                delivery_status=status,
                provider_response=response,
                created_by=activated_by,
            ))
            session.commit()
        finally:
            session.close()

    background_tasks.add_task(_send)

@router.post("/{id}/memberships", response_model=schemas_members.MemberMembership)
def create_membership(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
    membership_in: schemas_members.MembershipCreate,
) -> Any:
    """Attach a membership to a member (price picked from the active price).

    The permanent membership number is minted here when the member is already
    approved, otherwise during PUT /members/{id}/approve.
    """
    from models.masters import MembershipType

    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    mt = db.query(MembershipType).filter(
        MembershipType.id == membership_in.membership_type_id,
        MembershipType.is_deleted == False,
    ).first()
    if not mt:
        raise HTTPException(status_code=400, detail="Unknown membership_type_id")

    now = datetime.now(timezone.utc)
    price = active_price(db, membership_in.membership_type_id)
    obj = MemberMembership(
        member_id=member.id,
        membership_type_id=membership_in.membership_type_id,
        price_id=price.id if price else None,
        applied_at=now,
        status=membership_in.status,
        created_by=current_user.id,
    )
    if member.approval_status == "APPROVED":
        obj.membership_number = generate_next_number(db, "MEMBERSHIP_NO", "HMSM")
        obj.activated_at = now
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.post("/{id}/photo")
async def upload_member_photo(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
    file: UploadFile = File(...),
) -> Any:
    """Upload member photo."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    meta = await save_upload(file, subfolder="member_photos")
    member.photo_path = meta["file_path"]
    member.updated_by = current_user.id
    db.commit()
    return {"photo_path": meta["file_path"]}

@router.post("/documents/", response_model=schemas_members.MemberDocument)
async def upload_member_document(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    member_id: int,
    document_type_id: int,
    file: UploadFile = File(...),
) -> Any:
    """Upload a KYC document for a member."""
    from models.members import MemberDocument
    meta = await save_upload(file, subfolder="member_documents")
    doc = MemberDocument(
        member_id=member_id,
        document_type_id=document_type_id,
        file_path=meta["file_path"],
        original_filename=meta["original_filename"],
        mime_type=meta["mime_type"],
        file_size=meta["file_size"],
        created_by=current_user.id
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc

@router.delete("/{id}")
def delete_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
    reason: str,
    mode: str = "SOFT",
) -> Any:
    """Direct delete (no approval workflow): soft or permanent, with reason.

    PERMANENT hard-deletes the member and their dependent rows in one
    transaction; the money trail (receipt allocations) is detached, not
    destroyed. Soft delete keeps every row, flagged deleted.
    """
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if mode not in ("SOFT", "PERMANENT"):
        raise HTTPException(status_code=400, detail="mode must be SOFT or PERMANENT")

    now = datetime.now(timezone.utc)

    if mode == "PERMANENT":
        from api.v1.endpoints.approvals import _purge_member
        _purge_member(db, id)
        db.commit()
        return {"message": "Member permanently deleted", "member_id": id, "reason": reason, "mode": "PERMANENT"}

    member.is_deleted = True
    member.deleted_by = current_user.id
    member.deleted_at = now
    member.updated_by = current_user.id
    db.add(MemberApprovalHistory(
        member_id=id,
        action="DELETE",
        old_status=member.member_status,
        new_status="DELETED",
        reason=reason,
        acted_by=current_user.id,
        acted_at=now,
        created_by=current_user.id,
    ))
    db.commit()
    return {"message": "Member soft-deleted", "member_id": id, "reason": reason, "mode": "SOFT"}


@router.get("/{id}/profile")
def read_member_profile(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """Full 360° profile: personal, membership, services, money and history.

    Backs the member profile screen: personal details (both languages),
    membership details, service utilisation (magazine, events/temple,
    committee) and every change recorded against the member.
    """
    from models.members import (
        MemberDocument, MemberProfileChangeRequest, MemberProfileHistory,
        MembershipTypeHistory, MemberDeletionRequest, MemberKycRequest,
    )
    from models.masters import MembershipType
    from models.magazines import MagazineSubscription, MagazineReturn
    from models.events import EventMemberLink, Event, EventParticipant
    from models.receipts import Receipt, ReceiptAllocation

    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    def rows(model, order_by):
        q = db.query(model).filter(model.is_deleted == False, model.member_id == id)
        return [
            {c.name: getattr(r, c.name) for c in model.__table__.columns}
            for r in q.order_by(order_by).all()
        ]

    memberships = (
        db.query(MemberMembership, MembershipType)
        .join(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(MemberMembership.member_id == id, MemberMembership.is_deleted == False)
        .order_by(MemberMembership.applied_at.desc())
        .all()
    )
    from services.pricing import active_price

    membership_list = []
    for m, t in memberships:
        price = active_price(db, t.id)
        membership_list.append({
            "id": m.id,
            "membership_type_id": t.id,
            "type_code": t.code,
            "type_name_en": t.name_en,
            "type_name_kn": t.name_kn,
            "membership_number": m.membership_number,
            "status": m.status,
            "applied_at": m.applied_at,
            "activated_at": m.activated_at,
            "expires_at": m.expires_at,
            "current_price": float(price.amount) if price else None,
        })

    subscriptions = (
        db.query(MagazineSubscription)
        .filter(MagazineSubscription.member_id == id, MagazineSubscription.is_deleted == False)
        .all()
    )
    sub_ids = [s.id for s in subscriptions]
    magazine_returns = (
        db.query(MagazineReturn)
        .filter(
            MagazineReturn.subscription_id.in_(sub_ids),
            MagazineReturn.is_deleted == False,
        )
        .order_by(MagazineReturn.return_date.desc())
        .all()
        if sub_ids
        else []
    )
    events = (
        db.query(EventMemberLink, Event)
        .join(Event, Event.id == EventMemberLink.event_id)
        .filter(EventMemberLink.member_id == id)
        .order_by(Event.event_date.desc())
        .all()
    )
    # Spec: guests/honoured details on the profile of a Havyaka member.
    guest_honours = (
        db.query(EventParticipant, Event)
        .join(Event, Event.id == EventParticipant.event_id)
        .filter(
            EventParticipant.member_id == id,
            EventParticipant.is_deleted == False,
            Event.is_deleted == False,
        )
        .order_by(Event.event_date.desc())
        .all()
    )
    allocations = (
        db.query(ReceiptAllocation, Receipt)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(ReceiptAllocation.member_id == id)
        .order_by(Receipt.receipt_date.desc())
        .limit(50)
        .all()
    )

    profile_history = (
        db.query(MemberProfileHistory)
        .filter(MemberProfileHistory.member_id == id)
        .order_by(MemberProfileHistory.changed_at.desc())
        .limit(100)
        .all()
    )
    type_history = (
        db.query(MembershipTypeHistory)
        .filter(MembershipTypeHistory.member_id == id)
        .order_by(MembershipTypeHistory.changed_at.desc())
        .all()
    )

    return {
        "personal": {
            c.name: getattr(member, c.name)
            for c in Member.__table__.columns
            if c.name not in ("is_deleted", "deleted_by", "deleted_at")
        },
        "memberships": membership_list,
        "services": {
            "magazine": [
                {
                    "id": s.id,
                    "delivery_status": s.delivery_status,
                    "address_override": s.address_override,
                    "notes": s.notes,
                }
                for s in subscriptions
            ],
            "magazine_returns": [
                {
                    "id": r.id,
                    "subscription_id": r.subscription_id,
                    "issue_month_year": r.issue_month_year,
                    "return_date": r.return_date,
                    "return_reason": r.return_reason,
                    "follow_up_status": r.follow_up_status,
                }
                for r in magazine_returns
            ],
            "events": [
                {
                    "event_id": e.id,
                    "title": e.title,
                    "event_date": e.event_date,
                    "role": link.role,
                }
                for link, e in events
            ],
            "guests_and_honours": [
                {
                    "event_id": e.id,
                    "event_title": e.title,
                    "event_date": e.event_date,
                    "location": e.location,
                    "participant_type": p.participant_type,
                    "honoured_as": p.participant_role if p.participant_type == "HONOURED" else None,
                    "role": p.participant_role,
                }
                for p, e in guest_honours
            ],
        },
        "financial": {
            "receipts": [
                {
                    "receipt_id": r.id,
                    "receipt_number": r.receipt_number,
                    "receipt_date": r.receipt_date,
                    "receipt_type": r.receipt_type,
                    "net_amount": float(r.net_amount),
                    "payment_status": r.payment_status,
                    "allocated_amount": float(a.allocated_amount),
                }
                for a, r in allocations
            ],
        },
        "documents": rows(MemberDocument, MemberDocument.id.desc()),
        "profile_change_requests": [
            {
                "id": r.id,
                "status": r.status,
                "source": r.source,
                "new_values": r.new_values,
                "review_note": r.review_note,
            }
            for r in db.query(MemberProfileChangeRequest)
            .filter(MemberProfileChangeRequest.member_id == id)
            .order_by(MemberProfileChangeRequest.id.desc())
            .limit(50)
            .all()
        ],
        "history": {
            "profile_changes": [
                {
                    "field": h.field_name,
                    "old_value": h.old_value,
                    "new_value": h.new_value,
                    "changed_at": h.changed_at,
                    "changed_by": h.changed_by,
                }
                for h in profile_history
            ],
            "membership_type_changes": [
                {
                    "old_type_id": h.old_type_id,
                    "new_type_id": h.new_type_id,
                    "old_price": float(h.old_price) if h.old_price is not None else None,
                    "new_price": float(h.new_price),
                    "receipt_id": h.receipt_id,
                    "changed_at": h.changed_at,
                    "reason": h.reason,
                }
                for h in type_history
            ],
            "approvals": rows(MemberApprovalHistory, MemberApprovalHistory.acted_at.desc()),
        },
        "deletion_requests": [
            {
                "id": r.id,
                "deletion_type": r.deletion_type,
                "reason": r.reason,
                "status": r.status,
            }
            for r in db.query(MemberDeletionRequest)
            .filter(MemberDeletionRequest.member_id == id)
            .order_by(MemberDeletionRequest.id.desc())
            .all()
        ],
        "kyc_requests": [
            {
                "id": r.id,
                "status": r.status,
                "sent_at": r.sent_at,
                "submitted_at": r.submitted_at,
                "expires_at": r.expires_at,
            }
            for r in db.query(MemberKycRequest)
            .filter(MemberKycRequest.member_id == id)
            .order_by(MemberKycRequest.id.desc())
            .all()
        ],
    }

@router.post("/profile-changes/", response_model=schemas_members.MemberProfileChangeRequest)
def request_profile_change(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    req_in: schemas_members.MemberProfileChangeRequestCreate,
) -> Any:
    """Submit a profile change request.

    Deliberately left at authentication-only: members submit these themselves
    from the mobile app, and they only take effect after approval.
    """
    return crud_members.profile_change.create(db=db, obj_in=req_in, created_by=current_user.id)
