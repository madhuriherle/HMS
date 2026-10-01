from typing import Any, List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_
from crud import members as crud_members
from schemas import members as schemas_members
from schemas.common import PendingApproval
from api import deps
from models.masters import ServiceType
from models.members import Member, MemberApprovalHistory, MemberMembership, MemberServiceOptin
from models.users import User
from core.pagination import paginate
from services.sequences import generate_next_number
from services.pricing import active_price
from services.file_upload import save_upload
from services import approval_gate
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
    is_active: Optional[bool] = None,
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
    if is_active is not None:
        query = query.filter(Member.member_status == "ACTIVE") if is_active else query.filter(Member.member_status != "ACTIVE")
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


@router.post("/", response_model=Union[schemas_members.Member, PendingApproval], status_code=201)
@approval_gate.gated("members", "CREATE", "Member", "members.create")
def create_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
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

    # Mangalya-parity personal master references must exist.
    _member_master_checks(db, member_in.model_dump(exclude_unset=False))

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

@router.put("/{id}", response_model=Union[schemas_members.Member, PendingApproval])
@approval_gate.gated("members", "UPDATE", "Member", "members.update")
def update_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.update")),
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

    # Mangalya-parity personal master references must exist.
    _member_master_checks(db, data)

    return crud_members.member.update(db=db, db_obj=member, obj_in=data, updated_by=current_user.id)


def _member_master_checks(db: Session, data: dict) -> None:
    """Validate native-place/qualification/referred-by
    references against services.personal_masters.PERSONAL_MASTERS — the
    same registry masters.py's CRUD routes and delete guard use, so a new
    personal master only needs to be added there, not here too."""
    from services.personal_masters import PERSONAL_MASTERS

    for spec in PERSONAL_MASTERS:
        value = data.get(spec.member_field)
        if value:
            if not db.query(spec.model).filter(
                spec.model.id == value, spec.model.is_deleted == False  # noqa: E712
            ).first():
                raise HTTPException(400, f"Invalid {spec.member_field}")

    if data.get("referred_by_member_id"):
        if not db.query(Member).filter(
            Member.id == data["referred_by_member_id"], Member.is_deleted == False  # noqa: E712
        ).first():
            raise HTTPException(400, "Invalid referred_by_member_id")


def _member_master_details(db: Session, member: Member) -> dict:
    """Resolved names for the member's master-backed fields (profile screen).

    One UNION ALL query across every personal-master table instead of one
    SELECT per field (was ~9 sequential round-trips on every profile read —
    this is the hottest path that touches PERSONAL_MASTERS)."""
    from sqlalchemy import literal, select, union_all

    from services.personal_masters import PERSONAL_MASTERS

    selects = []
    for spec in PERSONAL_MASTERS:
        member_value = getattr(member, spec.member_field, None)
        if not member_value:
            continue
        selects.append(
            select(
                literal(spec.key).label("spec_key"),
                spec.model.id.label("id"),
                spec.model.name_en.label("name_en"),
                spec.model.name_kn.label("name_kn"),
            ).where(spec.model.id == member_value, spec.model.is_deleted == False)  # noqa: E712
        )

    resolved_by_key = {}
    if selects:
        stmt = union_all(*selects) if len(selects) > 1 else selects[0]
        for row in db.execute(stmt).all():
            resolved_by_key[row.spec_key] = {"id": row.id, "name_en": row.name_en, "name_kn": row.name_kn}

    referred = None
    if member.referred_by_member_id:
        ref = db.query(Member).filter(Member.id == member.referred_by_member_id).first()
        if ref:
            referred = {
                "id": ref.id,
                "member_code": ref.member_code,
                "name": ref.full_name_kn or f"{ref.first_name_en} {ref.last_name_en or ''}".strip(),
            }

    result = {}
    for spec in PERSONAL_MASTERS:
        resolved = resolved_by_key.get(spec.key)
        if not resolved and spec.text_field:
            text_value = getattr(member, spec.text_field, None)
            resolved = {"id": None, "name_en": text_value, "name_kn": None} if text_value else None
        result[spec.key] = resolved
    result["referred_by"] = referred
    return result

@router.put("/{id}/approve", response_model=schemas_members.Member)
# Not @approval_gate.gated: takes a BackgroundTasks param, which the generic
# engine can't capture into a JSON payload or usefully replay later (queued
# tasks only run inside the live ASGI request that created them).
def approve_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.update")),
    background_tasks: BackgroundTasks,
    id: int,
) -> Any:
    """Approve a member and auto-assign membership number."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Shared activation core with POST /receipts/{id}/activate-member so the
    # two entry points can never drift.
    from services.member_activation import activate_member
    member = activate_member(db, member, activated_by=current_user.id)

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

@router.post("/{id}/memberships", response_model=Union[schemas_members.MemberMembership, PendingApproval])
@approval_gate.gated("members", "CREATE", "MemberMembership", "members.create")
def create_membership(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
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
        family_membership_number=membership_in.family_membership_number,
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
# Not @approval_gate.gated: an UploadFile's bytes can't be captured into a
# JSON payload and replayed later.
async def upload_member_photo(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
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
# Not @approval_gate.gated: an UploadFile's bytes can't be captured into a
# JSON payload and replayed later.
async def upload_member_document(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
    member_id: int,
    document_type_id: int,
    file: UploadFile = File(...),
) -> Any:
    """Upload a KYC document for a member."""
    from models.members import MemberDocument
    if not crud_members.member.get(db=db, id=member_id):
        raise HTTPException(status_code=404, detail="Member not found")
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

@router.get("/{id}/documents")
def list_member_documents(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """KYC / supporting documents uploaded for a member."""
    from models.members import MemberDocument
    if not crud_members.member.get(db=db, id=id):
        raise HTTPException(status_code=404, detail="Member not found")
    docs = db.query(MemberDocument).filter(
        MemberDocument.member_id == id, MemberDocument.is_deleted == False
    ).order_by(MemberDocument.id.desc()).all()
    return {"total": len(docs), "data": [
        {
            "id": d.id, "member_id": d.member_id, "document_type_id": d.document_type_id,
            "original_filename": d.original_filename, "mime_type": d.mime_type,
            "file_size": d.file_size, "verification_status": d.verification_status,
            "verified_by": d.verified_by, "verified_at": d.verified_at, "created_at": d.created_at,
        } for d in docs
    ]}

def _get_document(db: Session, doc_id: int):
    from models.members import MemberDocument
    d = db.query(MemberDocument).filter(MemberDocument.id == doc_id, MemberDocument.is_deleted == False).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    return d

@router.get("/documents/{doc_id}/file")
def download_member_document(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.read")),
    doc_id: int,
) -> Any:
    import os
    from fastapi.responses import FileResponse
    d = _get_document(db, doc_id)
    if not os.path.isfile(d.file_path):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(d.file_path, media_type=d.mime_type or "application/octet-stream", filename=d.original_filename)

@router.put("/documents/{doc_id}", response_model=schemas_members.MemberDocument)
def verify_member_document(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.update")),
    doc_id: int, doc_in: schemas_members.MemberDocumentUpdate,
) -> Any:
    """Mark a document VERIFIED / REJECTED / PENDING."""
    from datetime import datetime, timezone
    d = _get_document(db, doc_id)
    status = (doc_in.verification_status or "").upper()
    if status not in ("PENDING", "VERIFIED", "REJECTED"):
        raise HTTPException(status_code=400, detail="verification_status must be PENDING, VERIFIED or REJECTED")
    d.verification_status = status
    d.verified_by = current_user.id if status != "PENDING" else None
    d.verified_at = datetime.now(timezone.utc) if status != "PENDING" else None
    d.updated_by = current_user.id
    db.commit(); db.refresh(d)
    return d

@router.delete("/documents/{doc_id}")
def delete_member_document(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.delete")),
    doc_id: int,
) -> Any:
    d = _get_document(db, doc_id)
    d.is_deleted = True; d.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

@router.delete("/{id}")
# Not @approval_gate.gated (generic engine): uses its own bespoke
# MemberDeletionRequest routing below instead — richer semantics
# (SOFT/PERMANENT, reason_id, cascading purge) than the generic engine's
# replay model would cleanly capture.
def delete_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.delete")),
    id: int,
    reason: str,
    mode: str = "SOFT",
) -> Any:
    """Delete a member — soft or permanent.

    Approval-gated per role grant, not hardcoded: if every role granting
    this caller members.delete has requires_approval=True (see
    POST/PUT /users/roles/{id}/permissions), the exact same call doesn't
    execute — it files a pending MemberDeletionRequest instead, for anyone
    holding approvals.write to approve/reject. A caller with at least one
    un-gated members.delete grant gets an immediate delete.
    """
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if mode not in ("SOFT", "PERMANENT"):
        raise HTTPException(status_code=400, detail="mode must be SOFT or PERMANENT")

    if deps.permission_requires_approval(db, current_user, "members.delete"):
        from models.members import MemberDeletionRequest
        from services.approval_notify import notify_approvers
        req = MemberDeletionRequest(
            member_id=id, requested_by=current_user.id,
            reason=reason, deletion_type=mode,
            status="PENDING", created_by=current_user.id,
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        notify_approvers(
            db,
            title=f"Approval needed: Delete member ({mode})",
            body=f"{current_user.name} requested to delete member #{id}. Reason: {reason}",
            data={"deletion_request_id": req.id, "member_id": id},
        )
        return {
            "message": "Your role requires approval to delete members; submitted for approval",
            "deletion_request_id": req.id,
            "status": "PENDING",
        }

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


# ─── SERVICE OPT-INS (Magazine, Temple, Mangalya, Hall, …) ──────
def _optin_payload(db: Session, optin: MemberServiceOptin) -> dict:
    """Optin row + its service_type's names, ready for the response schema."""
    st = db.query(ServiceType).filter(ServiceType.id == optin.service_type_id).first()
    return {
        "id": optin.id,
        "member_id": optin.member_id,
        "service_type_id": optin.service_type_id,
        "status": optin.status,
        "opted_at": optin.opted_at,
        "opted_via": optin.opted_via,
        "linked_type": optin.linked_type,
        "linked_id": optin.linked_id,
        "notes": optin.notes,
        "service_code": st.code if st else None,
        "service_name_en": st.name_en if st else None,
        "service_name_kn": st.name_kn if st else None,
    }


def _resolve_service_type(db: Session, service_type_id: int) -> ServiceType:
    st = db.query(ServiceType).filter(
        ServiceType.id == service_type_id, ServiceType.is_deleted == False  # noqa: E712
    ).first()
    if not st:
        raise HTTPException(400, f"Invalid service_type_id {service_type_id}")
    return st


def _dedicated_link(db: Session, member_id: int, service_type: ServiceType) -> tuple[Optional[str], Optional[int]]:
    """(linked_type, linked_id) for a service that owns a dedicated table.

    Only Magazine does today; it stays an explicit lookup rather than a
    convention so the next service with its own table is added here, not
    guessed at from the service code.
    """
    if service_type.code == "MAGAZINE":
        from models.magazines import MagazineSubscription

        sub = db.query(MagazineSubscription).filter(
            MagazineSubscription.member_id == member_id,
            MagazineSubscription.is_deleted == False,  # noqa: E712
        ).first()
        if sub:
            return "MAGAZINE_SUBSCRIPTION", sub.id
    return None, None


@router.get("/{id}/service-optins")
def read_member_service_optins(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
    status: Optional[str] = None,
) -> Any:
    """Every service this member has opted into (and, with status=CANCELLED,
    the ones they have withdrawn). Backs the profile's service list."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    q = db.query(MemberServiceOptin).filter(
        MemberServiceOptin.member_id == id,
        MemberServiceOptin.is_deleted == False,
    )
    if status:
        q = q.filter(MemberServiceOptin.status == status.upper())
    return {
        "member_id": id,
        "total": q.count(),
        "data": [_optin_payload(db, o) for o in q.order_by(MemberServiceOptin.opted_at.desc()).all()],
    }


@router.post("/{id}/service-optins", response_model=Union[schemas_members.MemberServiceOptin, PendingApproval], status_code=201)
@approval_gate.gated("members", "CREATE", "MemberServiceOptin", "members.create", id_param="id")
def create_service_optin(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
    id: int,
    optin_in: schemas_members.MemberServiceOptinCreate,
) -> Any:
    """Opt a member into a service.

    One live opt-in per (member, service) — a second POST for a service the
    member already has returns 409, unless the existing opt-in is CANCELLED,
    in which case it's reinstated rather than duplicated (so the partial
    unique index never has to be worked around). For a service that has its
    own dedicated table (Magazine), linked_id is filled in automatically
    rather than being the caller's problem.
    """
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    st = _resolve_service_type(db, optin_in.service_type_id)

    existing = crud_members.service_optin.get_active(
        db, member_id=id, service_type_id=optin_in.service_type_id
    )
    if existing:
        if existing.status != "CANCELLED":
            raise HTTPException(
                409,
                f"Member {id} already has an ACTIVE opt-in for service "
                f"'{st.code}' (optin id={existing.id})",
            )
        existing.status = "ACTIVE"
        existing.opted_at = datetime.now(timezone.utc)
        existing.opted_via = optin_in.opted_via
        if optin_in.notes is not None:
            existing.notes = optin_in.notes
        existing.updated_by = current_user.id
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _optin_payload(db, existing)

    linked_type, linked_id = optin_in.linked_type, optin_in.linked_id
    if linked_id is None:
        linked_type, linked_id = _dedicated_link(db, id, st)

    obj = MemberServiceOptin(
        member_id=id,
        service_type_id=st.id,
        status=optin_in.status or "ACTIVE",
        opted_at=datetime.now(timezone.utc),
        opted_via=optin_in.opted_via or "ADMIN",
        linked_type=linked_type,
        linked_id=linked_id,
        notes=optin_in.notes,
        created_by=current_user.id,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _optin_payload(db, obj)


@router.post("/{id}/service-optins/bulk", response_model=schemas_members.BulkServiceOptinResult, status_code=201)
# Not @approval_gate.gated: the generic engine captures kwargs as JSON and
# would replay this as a single opt-in, not the whole set — filing one request
# per service instead would be a half-truth in the approver's queue. Instead it
# demands the grant for BOTH sides of the change (adding and withdrawing), so
# no permission gap opens up next to the gated single-service routes.
def bulk_set_service_optins(
    *,
    db: Session = Depends(deps.get_db),
    _create_granted: User = Depends(deps.require_permission("members.create")),
    current_user: User = Depends(deps.require_permission("members.update")),
    id: int,
    optin_in: schemas_members.BulkServiceOptin,
) -> Any:
    """Set a member's full service selection in one call (the registration
    form's checkbox group). Services in `opt_out` that they currently hold are
    cancelled; `opt_in` adds or reinstates. Returns the resulting list.
    """
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    now = datetime.now(timezone.utc)
    created, updated = [], []

    for service_type_id in optin_in.opt_in:
        st = _resolve_service_type(db, service_type_id)
        existing = crud_members.service_optin.get_active(
            db, member_id=id, service_type_id=service_type_id
        )
        if existing:
            if existing.status == "CANCELLED":
                existing.status = "ACTIVE"
                existing.opted_at = now
                existing.updated_by = current_user.id
                db.add(existing)
                updated.append(service_type_id)
            continue
        linked_type, linked_id = _dedicated_link(db, id, st)
        db.add(MemberServiceOptin(
            member_id=id, service_type_id=st.id, status="ACTIVE",
            opted_at=now, opted_via=optin_in.opted_via or "ADMIN",
            linked_type=linked_type, linked_id=linked_id,
            created_by=current_user.id,
        ))
        created.append(service_type_id)

    for service_type_id in optin_in.opt_out:
        _resolve_service_type(db, service_type_id)
        existing = crud_members.service_optin.get_active(
            db, member_id=id, service_type_id=service_type_id
        )
        if existing and existing.status == "ACTIVE":
            existing.status = "CANCELLED"
            existing.updated_by = current_user.id
            db.add(existing)
            updated.append(service_type_id)

    db.commit()

    q = db.query(MemberServiceOptin).filter(
        MemberServiceOptin.member_id == id, MemberServiceOptin.is_deleted == False  # noqa: E712
    ).order_by(MemberServiceOptin.opted_at.desc()).all()
    return {
        "member_id": id,
        "opted_in": created,
        "changed": updated,
        "data": [_optin_payload(db, o) for o in q],
    }


@router.put("/{id}/service-optins/{optin_id}", response_model=Union[schemas_members.MemberServiceOptin, PendingApproval])
@approval_gate.gated("members", "UPDATE", "MemberServiceOptin", "members.update", id_param="optin_id")
def update_service_optin(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.update")),
    id: int,
    optin_id: int,
    optin_in: schemas_members.MemberServiceOptinUpdate,
) -> Any:
    """Change an opt-in — typically status ACTIVE→CANCELLED when a member
    withdraws from a service."""
    optin = _member_optin_or_404(db, id, optin_id)
    data = optin_in.model_dump(exclude_unset=True)
    crud_members.service_optin.update(db, db_obj=optin, obj_in=data, updated_by=current_user.id)
    db.refresh(optin)
    return _optin_payload(db, optin)


@router.delete("/{id}/service-optins/{optin_id}", response_model=Union[schemas_members.MemberServiceOptin, PendingApproval])
@approval_gate.gated("members", "DELETE", "MemberServiceOptin", "members.delete", id_param="optin_id")
def delete_service_optin(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.delete")),
    id: int,
    optin_id: int,
) -> Any:
    """Remove an opt-in outright (soft delete, so it stays in the audit trail
    and the member timeline). Use PUT with status=CANCELLED to withdraw while
    keeping the history visible."""
    optin = _member_optin_or_404(db, id, optin_id)
    return crud_members.service_optin.remove(db, id=optin_id, deleted_by=current_user.id)


def _member_optin_or_404(db: Session, member_id: int, optin_id: int) -> MemberServiceOptin:
    optin = db.query(MemberServiceOptin).filter(
        MemberServiceOptin.id == optin_id,
        MemberServiceOptin.member_id == member_id,   # don't let /members/1/... touch another member's optin
        MemberServiceOptin.is_deleted == False,       # noqa: E712
    ).first()
    if not optin:
        raise HTTPException(404, "Service opt-in not found for this member")
    return optin


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
    from models.masters import MembershipType, ServiceType
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
    # Generic service opt-in list (Temple, Mangalya, Hall, …) joined to the
    # service_types catalogue, so the profile screen can render one loop
    # instead of a hand-written block per service.
    service_optins = (
        db.query(MemberServiceOptin, ServiceType)
        .join(ServiceType, ServiceType.id == MemberServiceOptin.service_type_id)
        .filter(
            MemberServiceOptin.member_id == id,
            MemberServiceOptin.is_deleted == False,  # noqa: E712
            MemberServiceOptin.status == "ACTIVE",
        )
        .order_by(ServiceType.name_en)
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
            # Generic opt-ins (Temple, Mangalya, Hall, …) — the catalogue is
            # driven, so a new service_type row shows up here with no code
            # change. Magazine also appears here, but its lifecycle detail
            # (address override, pauses, returns) lives in the blocks below.
            "opted": [
                {
                    "id": o.id,
                    "service_type_id": t.id,
                    "service_code": t.code,
                    "service_name_en": t.name_en,
                    "service_name_kn": t.name_kn,
                    "status": o.status,
                    "opted_at": o.opted_at,
                    "opted_via": o.opted_via,
                    "linked_type": o.linked_type,
                    "linked_id": o.linked_id,
                    "notes": o.notes,
                }
                for o, t in service_optins
            ],
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
        "personal_masters": _member_master_details(db, member),
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
    created = crud_members.profile_change.create(db=db, obj_in=req_in, created_by=current_user.id)
    from services.approval_notify import notify_approvers
    notify_approvers(
        db,
        title="Approval needed: Member profile change",
        body=f"{current_user.name} requested a profile change for member #{req_in.member_id}.",
        data={"profile_change_request_id": created.id, "member_id": req_in.member_id},
    )
    return created


# ─── ACTIVATION REQUEST ──────────────────────────────────────
class _LoopTasks:
    """BackgroundTasks stand-in for replays run inside an already-running
    event loop (the generic approval engine), where no request-scoped
    BackgroundTasks exists."""
    def add_task(self, fn, *args, **kwargs):
        import asyncio
        asyncio.get_running_loop().create_task(fn(*args, **kwargs))


def activate_member_request(*, db: Session, current_user: User, id: int) -> Any:
    """Replay target for a filed activation request: assigns the permanent
    membership number (shared core) and sends the activation WhatsApp."""
    from services.member_activation import activate_member
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member = activate_member(db, member, activated_by=current_user.id)
    db.commit()
    db.refresh(member)
    _queue_activation_notification(db, _LoopTasks(), member, activated_by=current_user.id)
    return member


import inspect as _inspect
from services import approval_registry as _approval_registry
_approval_registry.register("members", "ACTIVATE", "Member", activate_member_request, _inspect.signature(activate_member_request))


@router.post("/{id}/request-activation")
def request_member_activation(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.create")),
    id: int,
) -> Any:
    """File an activation request (permanent membership number assignment).
    An approver with approvals.write approves it from the approvals queue,
    which runs the same activation core as PUT /members/{id}/approve."""
    from models.approval_requests import ApprovalRequest
    from services.approval_gate import _file_request

    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.approval_status == "APPROVED" and member.member_code:
        raise HTTPException(status_code=400, detail="Member is already activated")
    dup = db.query(ApprovalRequest).filter(
        ApprovalRequest.module == "members", ApprovalRequest.action == "ACTIVATE",
        ApprovalRequest.entity_id == id, ApprovalRequest.status == "PENDING",
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"Activation already requested (request {dup.id})")
    return _file_request(db, current_user, "members", "ACTIVATE", "Member",
                         "members.activate", {"id": id}, "id")
