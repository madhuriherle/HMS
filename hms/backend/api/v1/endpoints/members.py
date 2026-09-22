from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
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
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    gender: Optional[str] = None,
    approval_status: Optional[str] = None,
    member_status: Optional[str] = None,
    membership_type_id: Optional[int] = None,
    registration_source: Optional[str] = None,
    search: Optional[str] = None,
) -> Any:
    """Retrieve members with optional filters and search."""
    query = db.query(Member).filter(Member.is_deleted == False)

    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)
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
            Member.mobile.ilike(f"%{search}%"),
            Member.member_code.ilike(f"%{search}%"),
            Member.email.ilike(f"%{search}%"),
        ))

    return paginate(query, page, limit)

@router.post("/", response_model=schemas_members.Member)
def create_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    member_in: schemas_members.MemberCreate,
) -> Any:
    """Register a new member with duplicate check."""
    # Duplicate check
    if member_in.mobile:
        existing = db.query(Member).filter(
            Member.mobile == member_in.mobile,
            Member.is_deleted == False
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Member with mobile {member_in.mobile} already exists (ID: {existing.id})")
    # Pincode validation
    if member_in.pincode_id:
        from models.masters import PostalCode
        pc = db.query(PostalCode).filter(PostalCode.id == member_in.pincode_id).first()
        if not pc:
            raise HTTPException(status_code=400, detail="Invalid pincode_id")

    db_obj = Member(**member_in.model_dump(), created_by=current_user.id)
    db.add(db_obj)
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
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return crud_members.member.update(db=db, db_obj=member, obj_in=member_in, updated_by=current_user.id)

@router.put("/{id}/approve", response_model=schemas_members.Member)
def approve_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
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
    return member

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

@router.delete("/{id}", response_model=schemas_members.Member)
def delete_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return crud_members.member.remove(db=db, id=id, deleted_by=current_user.id)

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
