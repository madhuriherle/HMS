from typing import Any, List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, BackgroundTasks, Request
import glob
import os
import re
import pydantic
from pydantic import model_validator, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from crud import members as crud_members
from schemas import members as schemas_members
from schemas.common import PendingApproval
from api import deps
from models.masters import ServiceType
from models.members import Member, MemberApprovalHistory, MemberImportRun, MemberMembership, MemberServiceOptin
from models.users import User
from core.config import settings
from core.pagination import paginate
from services.sequences import generate_next_number
from services.pricing import active_price
from services.file_upload import IMAGE_TYPES, save_upload
from services import approval_gate
from datetime import date, datetime, timezone

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
    mobile_status: Optional[str] = None,  # MISSING (no mobile at all) | INVALID (the register's number was unusable)
    payment_status: Optional[str] = None,  # NO_RECEIPT | MISMATCH (receipts pay less than the price) | NOT_MAPPED (their number is on an unassigned receipt)
    include_deleted: bool = False,
    search: Optional[str] = None,
    membership_no: Optional[str] = None,   # EXACT membership number only (never part of a number, a name or a mobile)
    sort_by: Optional[str] = None,   # id | created_at | name | member_code | mobile | approval_status | member_status
    sort_dir: str = "desc",
    no_membership_type: bool = False,   # members who have not reached any type yet
    receipt_assigned: Optional[bool] = None,   # True: has a receipt mapped; False: none yet
    with_receipt: bool = False,         # carry each member's latest receipt and the with / without counts
    exported: Optional[bool] = None,    # True: only applicants that were on a meeting PDF; False: never exported
    exported_on: Optional[date] = None, # only applicants that were on a meeting PDF exported that day
) -> Any:
    """Retrieve members with optional filters and search (offline + online). Newest first unless sort_by is given.
    At most 200 per request (rule 10.6); the search and the filters run on every member, the page is a slice."""
    from core.pagination import LIST_PAGE_MAX
    limit = max(1, min(limit, LIST_PAGE_MAX))
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
    if mobile_status:
        no_mobile = or_(Member.mobile.is_(None), Member.mobile == "")
        if mobile_status.upper() == "MISSING":
            query = query.filter(no_mobile)
        elif mobile_status.upper() == "INVALID":
            query = query.filter(no_mobile, Member.mobile_raw.isnot(None), Member.mobile_raw != "")
    if payment_status:
        wanted = payment_status.upper()
        if wanted in ("NO_RECEIPT", "MISMATCH"):
            from services import membership_credit
            ids = [mid for mid, c in membership_credit.payment_check_rows(db).items()
                   if c["mismatch"] and (c["no_receipt"] if wanted == "NO_RECEIPT" else not c["no_receipt"])]
            query = query.filter(Member.id.in_(ids or [0]))
        elif wanted == "NOT_MAPPED":
            from models.receipts import Receipt
            typed = func.upper(func.trim(Receipt.payer_membership_no))
            waiting = db.query(typed).filter(
                Receipt.is_deleted == False, Receipt.receipt_status == "UNASSIGNED",  # noqa: E712
                Receipt.payment_status != "CANCELLED", Receipt.payer_membership_no.isnot(None),
            )
            query = query.filter(or_(
                func.upper(func.trim(Member.membership_number)).in_(waiting),
                Member.id.in_(db.query(MemberMembership.member_id).filter(
                    MemberMembership.is_deleted == False,  # noqa: E712
                    func.upper(func.trim(MemberMembership.membership_number)).in_(waiting))),
            ))
    if membership_type_id:
        query = query.join(
            MemberMembership, MemberMembership.member_id == Member.id
        ).filter(
            MemberMembership.membership_type_id == membership_type_id,
            MemberMembership.is_deleted == False,
        ).distinct()
    if no_membership_type:
        query = query.filter(~Member.id.in_(
            db.query(MemberMembership.member_id).filter(
                MemberMembership.is_deleted == False,  # noqa: E712
                MemberMembership.membership_type_id.isnot(None),
            )
        ))
    if membership_no and membership_no.strip():
        up = membership_no.strip().upper()
        query = query.filter(or_(
            func.upper(Member.member_code) == up,
            Member.id.in_(db.query(MemberMembership.member_id).filter(
                MemberMembership.is_deleted == False, func.upper(MemberMembership.membership_number) == up)),  # noqa: E712
        ))
    if search:
        from models.masters import District, PostalCode  # the list also shows the place: search it too
        query = query.filter(or_(
            Member.full_name_en.ilike(f"%{search}%"),
            Member.first_name_en.ilike(f"%{search}%"),
            Member.last_name_en.ilike(f"%{search}%"),
            Member.full_name_kn.ilike(f"%{search}%"),
            Member.mobile.ilike(f"%{search}%"),
            Member.alternate_mobile.ilike(f"%{search}%"),
            Member.member_code.ilike(f"%{search}%"),
            Member.old_membership_number == search.strip(),
            Member.email.ilike(f"%{search}%"),
            Member.locality.ilike(f"%{search}%"),
            Member.city.ilike(f"%{search}%"),
            Member.district_id.in_(db.query(District.id).filter(District.name_en.ilike(f"%{search}%"))),
            Member.pincode_id.in_(db.query(PostalCode.id).filter(PostalCode.pincode.ilike(f"%{search}%"))),
        ))

    if exported is not None or exported_on:
        from models.members import MemberMeetingExport
        on_pdf = db.query(MemberMeetingExport.member_id).filter(MemberMeetingExport.is_deleted == False)  # noqa: E712
        if exported_on:
            on_pdf = on_pdf.filter(MemberMeetingExport.exported_on == exported_on)
        query = query.filter(Member.id.notin_(on_pdf) if (exported is False and not exported_on) else Member.id.in_(on_pdf))

    summary = None
    if with_receipt or receipt_assigned is not None:
        from models.receipts import Receipt, ReceiptAllocation
        mapped = db.query(ReceiptAllocation.member_id).join(Receipt, Receipt.id == ReceiptAllocation.receipt_id).filter(
            ReceiptAllocation.is_deleted == False, ReceiptAllocation.member_id.isnot(None),  # noqa: E712
            Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
        )
        if with_receipt:   # counts of the whole filtered set, before the receipt filter narrows it
            with_n = query.filter(Member.id.in_(mapped)).count()
            summary = {"with_receipt": with_n, "without_receipt": query.count() - with_n}
        if receipt_assigned is True:
            query = query.filter(Member.id.in_(mapped))
        elif receipt_assigned is False:
            query = query.filter(~Member.id.in_(mapped))

    from core.sorting import sort_query
    query = sort_query(
        query, sort_by=sort_by, sort_dir=sort_dir, tiebreak=Member.id,
        allowed={"id": Member.id, "created_at": Member.created_at, "name": Member.full_name_en, "member_code": Member.member_code,
                 "mobile": Member.mobile, "approval_status": Member.approval_status, "member_status": Member.member_status},
        newest_first=(Member.created_at.desc(),),
    )
    result = paginate(query, page, limit)
    _attach_membership_types(db, result["data"])
    if with_receipt:
        _attach_latest_receipts(db, result["data"])
        _attach_meeting_info(db, result["data"])
        result["summary"] = summary
    return result


@router.get("/label-list")
def read_label_list(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 25,
    search: Optional[str] = None,
    membership_type_id: Optional[int] = None,
    from_date: Optional[date] = None,     # last receipt on or after
    to_date: Optional[date] = None,       # last receipt on or before
) -> Any:
    """The members who have paid (a receipt is mapped to them), each with the date of their latest receipt, newest
    first. At most 200 per request (rule 10.6); the search and the filters run on every member."""
    from core.pagination import LIST_PAGE_MAX, _to_plain
    from models.masters import District, PostalCode
    from models.receipts import Receipt, ReceiptAllocation
    limit = max(1, min(limit, LIST_PAGE_MAX))
    last = func.max(Receipt.receipt_date).label("last_receipt_date")
    q = (
        db.query(Member, last)
        .join(ReceiptAllocation, ReceiptAllocation.member_id == Member.id)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(
            Member.is_deleted == False,  # noqa: E712
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
        )
        .group_by(Member.id)
    )
    if membership_type_id:
        q = q.filter(Member.id.in_(
            db.query(MemberMembership.member_id).filter(
                MemberMembership.membership_type_id == membership_type_id, MemberMembership.is_deleted == False,  # noqa: E712
            )
        ))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            Member.first_name_en.ilike(like), Member.middle_name_en.ilike(like), Member.last_name_en.ilike(like),
            Member.mobile.ilike(like), Member.member_code.ilike(like), Member.old_membership_number == like.strip("%"), Member.email.ilike(like),
            Member.locality.ilike(like), Member.city.ilike(like),
            Member.district_id.in_(db.query(District.id).filter(District.name_en.ilike(like))),
            Member.pincode_id.in_(db.query(PostalCode.id).filter(PostalCode.pincode.ilike(like))),
        ))
    if from_date:
        q = q.having(last >= from_date)
    if to_date:
        q = q.having(last <= to_date)
    q = q.order_by(last.desc(), Member.id.desc())
    result = paginate(q, page, limit, serializer=lambda row: {**_to_plain(row[0], set()), "last_receipt_date": row[1].isoformat() if row[1] else None})
    _attach_membership_types(db, result["data"])
    return result


def _attach_meeting_info(db: Session, rows: list) -> None:
    """Each listed applicant carries the day of their latest meeting PDF (None when never exported), and for a
    rejected one the reason and day of the latest Disagree."""
    from models.members import MemberMeetingExport
    ids = [r.get("id") for r in rows if isinstance(r, dict) and r.get("id")]
    last, rejected = {}, {}
    if ids:
        for member_id, day in (
            db.query(MemberMeetingExport.member_id, func.max(MemberMeetingExport.exported_on))
            .filter(MemberMeetingExport.member_id.in_(ids), MemberMeetingExport.is_deleted == False)  # noqa: E712
            .group_by(MemberMeetingExport.member_id).all()
        ):
            last[member_id] = day.isoformat()
        for h in (
            db.query(MemberApprovalHistory)
            .filter(MemberApprovalHistory.member_id.in_(ids), MemberApprovalHistory.action == "REJECT")
            .order_by(MemberApprovalHistory.id.asc()).all()
        ):
            rejected[h.member_id] = {"reason": h.reason, "on": h.acted_at.date().isoformat() if h.acted_at else None}
    for r in rows:
        if isinstance(r, dict):
            r["last_exported_on"] = last.get(r.get("id"))
            r["rejection"] = rejected.get(r.get("id"))


def _attach_latest_receipts(db: Session, rows: list) -> None:
    """Each listed member carries the latest receipt mapped to them (None when there is none)."""
    from models.receipts import Receipt, ReceiptAllocation
    ids = [r.get("id") for r in rows if isinstance(r, dict) and r.get("id")]
    latest = {}
    if ids:
        for alloc, receipt in (
            db.query(ReceiptAllocation, Receipt)
            .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
            .filter(
                ReceiptAllocation.member_id.in_(ids), ReceiptAllocation.is_deleted == False,  # noqa: E712
                Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
            )
            .order_by(ReceiptAllocation.id.desc())
            .all()
        ):
            if alloc.member_id not in latest:
                latest[alloc.member_id] = {
                    "id": receipt.id, "receipt_number": receipt.receipt_number,
                    "receipt_date": receipt.receipt_date.isoformat() if receipt.receipt_date else None,
                    "amount": float(receipt.net_amount), "payment_mode": receipt.payment_mode,
                    "bank_account": receipt.bank_account, "transaction_reference": receipt.transaction_reference,
                    "payment_status": receipt.payment_status, "receipt_status": receipt.receipt_status,
                }
    for r in rows:
        if isinstance(r, dict):
            r["receipt"] = latest.get(r.get("id"))


def _attach_places(db: Session, rows: list) -> None:
    """Each member row carries its whole place - PIN, post office, taluk, district, state - so a list or a popup never
    needs the master lists (or extra calls) just to show names (REMEMBER.txt 10.7)."""
    from models.masters import District, PostalCode, State, Taluk
    def _names(model, key):
        wanted = {r.get(key) for r in rows if isinstance(r, dict) and r.get(key)}
        if not wanted:
            return {}
        return {x.id: x for x in db.query(model).filter(model.id.in_(wanted)).all()}
    pins, states, districts, taluks = _names(PostalCode, "pincode_id"), _names(State, "state_id"), _names(District, "district_id"), _names(Taluk, "taluk_id")
    for r in rows:
        if isinstance(r, dict):
            pin = pins.get(r.get("pincode_id"))
            r["pincode"] = pin.pincode if pin else None
            r["post_office_name"] = pin.post_office_name if pin else None
            r["state_name"] = states[r["state_id"]].name_en if r.get("state_id") in states else None
            r["district_name"] = districts[r["district_id"]].name_en if r.get("district_id") in districts else None
            r["taluk_name"] = taluks[r["taluk_id"]].name_en if r.get("taluk_id") in taluks else None


def _attach_membership_types(db: Session, rows: list) -> None:
    """Each listed member carries the name of their current membership type (the latest membership record) and their
    place names. (The amount paid is not listed: it is worked out for a member's own profile, not for every row.)"""
    from models.masters import District, MembershipType, PostalCode, State, Taluk
    ids = [r.get("id") for r in rows if isinstance(r, dict) and r.get("id")]
    if not ids:
        return
    latest = {}
    for ms, t in (
        db.query(MemberMembership, MembershipType)
        .join(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(MemberMembership.member_id.in_(ids), MemberMembership.is_deleted == False)  # noqa: E712
        .order_by(MemberMembership.id.asc())
        .all()
    ):
        latest[ms.member_id] = (t.id, t.name_en, ms.membership_number)
    _attach_places(db, rows)
    from services import membership_credit
    checks = membership_credit.payment_check_rows(db, ids)   # who paid less than the price of their joining era
    for r in rows:
        if isinstance(r, dict):
            check = checks.get(r.get("id"))
            r["payment_mismatch"] = bool(check and check["mismatch"])
            r["payment_shortfall"] = check["shortfall"] if check and check["mismatch"] else None
            r["payment_no_receipt"] = bool(check and check["mismatch"] and check["no_receipt"])
            tid, name, ms_number = latest.get(r.get("id"), (None, None, None))
            r["membership_type_id"] = tid
            r["membership_type"] = name
            mem_no = r.get("membership_number") or r.get("member_code") or ms_number
            if mem_no:
                r["membership_number"] = mem_no
                r["member_code"] = mem_no


MAGAZINE_KINDS = {"PHYSICAL", "EMAIL"}


def _magazine_choice(data: dict, *, needed, own_email=None) -> None:
    """Check the magazine choice and tidy it: the kind must be known, an e-copy is read online so an email is
    optional (kept when typed, else the member's own), and a member who only wants the e-copy has no delivery address."""
    kind = data.get("magazine_kind")
    if kind is not None and kind not in MAGAZINE_KINDS:
        raise HTTPException(400, f"magazine_kind must be one of {sorted(MAGAZINE_KINDS)}")
    if not needed:
        return
    kind = kind or "PHYSICAL"
    data["magazine_kind"] = kind
    if kind == "EMAIL":
        data["magazine_email"] = (data.get("magazine_email") or own_email or "").strip() or None
    else:
        data["magazine_email"] = None
    if kind == "EMAIL":
        data["magazine_delivery_address"] = None


@router.post("/", response_model=Union[schemas_members.Member, PendingApproval], status_code=201)
@approval_gate.gated("members", "CREATE", "Member", "members.write")
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

    # ── Duplicate validation (shared family mobile is allowed; warn only on Kannada name + DOB) ──
    if member_in.full_name_kn and member_in.date_of_birth:
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

    fields = member_in.model_dump()
    existing = bool(fields.pop("existing_member", False))
    typed_number = (fields.pop("existing_membership_number", None) or "").strip()
    if existing:
        if not typed_number:
            raise HTTPException(status_code=400, detail="Enter the membership number of the existing member")
        in_use = db.query(MemberModel.id).filter(
            MemberModel.membership_number == typed_number, MemberModel.is_deleted == False,  # noqa: E712
        ).first() or db.query(MemberMembership.id).filter(
            MemberMembership.membership_number == typed_number, MemberMembership.is_deleted == False,  # noqa: E712
        ).first()
        if in_use:
            raise HTTPException(status_code=409, detail=f"Membership number {typed_number} is already used by another member")
    _magazine_choice(fields, needed=fields.get("magazine_needed"), own_email=fields.get("email"))
    db_obj = MemberModel(**fields, created_by=current_user.id)
    db.add(db_obj)
    db.flush()

    if existing:
        # already a member: approved straight away with the typed number (no receipt or meeting needed)
        now = datetime.now(timezone.utc)
        db_obj.membership_number = typed_number
        db_obj.approval_status = "APPROVED"
        db_obj.approved_by = current_user.id
        db_obj.approved_at = now
        db.add(MemberApprovalHistory(
            member_id=db_obj.id, action="APPROVE", old_status="UNAPPROVED", new_status="APPROVED",
            reason="Existing approved member entered with membership number " + typed_number,
            acted_by=current_user.id, acted_at=now, created_by=current_user.id,
        ))
        db.flush()

    if db_obj.magazine_needed:
        # a member who says Yes is on the magazine subscription straight away (no separate accept step)
        from services.magazine_subscriptions import sync_member_magazine_subscription
        sync_member_magazine_subscription(db, db_obj, user_id=current_user.id)

    db.commit()
    db.refresh(db_obj)
    return db_obj

# ─── PUBLIC WEBSITE REGISTRATION ─────────────────────────────

# Fields a website visitor may set on themselves. Deliberately narrower than
# MemberCreate: no registration_source/registration_status (forced to
# ONLINE/PENDING), no referred_by_member_id (self-referrals would poison the
# referral stats), no aadhaar (KYC document flow owns that).
_PUBLIC_REGISTER_ALLOWED = {
    "first_name_en", "middle_name_en", "last_name_en", "full_name_kn",
    "gender", "date_of_birth", "father_husband_name", "blood_group",
    "native_place_id", "native_place_text", "qualification_id",
    "qualification_text", "gotra_id", "gotra_text", "occupation", "designation", "native_address", "native_same_as_current",
    "mobile", "mobile_country_code", "alternate_mobile", "whatsapp_number",
    "email", "address_line1", "address_line2", "locality", "area", "place",
    "grama", "village", "label_point", "address_remarks",
    "address_line1_kn", "address_line2_kn", "locality_kn",
    "state_id", "district_id", "taluk_id", "pincode_id",
}


class PublicMemberRegister(schemas_members.MemberCreate):
    """Website signup body — unknown/private fields rejected outright."""

    model_config = ConfigDict(extra="forbid")

    registration_source: str = "ONLINE"  # keep the base validator happy; forced below

    @model_validator(mode="after")
    def _reject_private_fields(self) -> "PublicMemberRegister":
        supplied = set(self.model_dump(exclude_unset=True))
        private = sorted(supplied - _PUBLIC_REGISTER_ALLOWED)
        if private:
            raise ValueError(f"Fields not allowed on public registration: {', '.join(private)}")
        if not (self.mobile or self.email):
            raise ValueError("mobile or email is required")
        return self


@router.post("/public-register", status_code=201)
def public_register_member(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    member_in: PublicMemberRegister,
) -> Any:
    """Self-registration from the public website — no authentication.

    The website cannot call POST /members (that needs a members.write token),
    so this is the website's own door. Safety rails:
    * rate limited 5 / hour per IP (the limiter is in-process like auth's);
    * every identity/status column is forced: registration_source=ONLINE,
      approval_status=UNAPPROVED, member_status=ACTIVE, no member_code —
      the payload cannot mint an approved member;
    * the same duplicate checks as staff registration (mobile, or Kannada
      name + date of birth) so a 409 tells the visitor they are already
      registered;
    * the MEMBER login account is provisioned exactly as staff registration
      does, so the mobile app works from day one.
    Members appear in the unapproved list for an admin to approve.
    """
    from core.ratelimit import rate_limiter

    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"public-register:{client_ip}", max_hits=5, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many registration attempts from this address. Please try again later.",
        )

    from models.masters import PostalCode, State, District, Taluk
    from models.members import Member as MemberModel

    # ── Duplicate validation (shared family mobile is allowed; warn on Kannada name + DOB) ──
    if member_in.full_name_kn and member_in.date_of_birth:
        existing_kn = db.query(MemberModel).filter(
            MemberModel.full_name_kn == member_in.full_name_kn,
            MemberModel.date_of_birth == member_in.date_of_birth,
            MemberModel.is_deleted == False,  # noqa: E712
        ).first()
        if existing_kn:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Duplicate: a member with Kannada name '{member_in.full_name_kn}' "
                    f"and the same date of birth is already registered (ID: {existing_kn.id})"
                ),
            )

    # ── Geography cross-checks (same rules as staff registration) ──
    if member_in.pincode_id:
        pc = db.query(PostalCode).filter(PostalCode.id == member_in.pincode_id).first()
        if not pc:
            raise HTTPException(status_code=400, detail="Invalid pincode_id")
        if not member_in.state_id:
            member_in.state_id = pc.state_id
        if not member_in.district_id:
            member_in.district_id = pc.district_id
        if not member_in.taluk_id and pc.taluk_id:
            member_in.taluk_id = pc.taluk_id
    if member_in.state_id and not db.query(State).filter(State.id == member_in.state_id).first():
        raise HTTPException(status_code=400, detail="Invalid state_id")
    if member_in.district_id:
        district = db.query(District).filter(District.id == member_in.district_id).first()
        if not district:
            raise HTTPException(status_code=400, detail="Invalid district_id")
        if member_in.state_id and district.state_id != member_in.state_id:
            raise HTTPException(status_code=400, detail="district_id does not belong to state_id")
    if member_in.taluk_id:
        taluk = db.query(Taluk).filter(Taluk.id == member_in.taluk_id).first()
        if not taluk:
            raise HTTPException(status_code=400, detail="Invalid taluk_id")
        if member_in.district_id and taluk.district_id != member_in.district_id:
            raise HTTPException(status_code=400, detail="taluk_id does not belong to district_id")

    _member_master_checks(db, member_in.model_dump(exclude_unset=False))

    from core.security import get_password_hash
    from models.users import User as UserModel
    from services.permissions import get_role_by_code

    data = member_in.model_dump(exclude_unset=True)
    data.pop("registration_source", None)  # always ONLINE below, never caller-chosen
    db_obj = MemberModel(
        **data,
        registration_source="ONLINE",
        registration_status="PENDING",
        approval_status="UNAPPROVED",
        member_status="ACTIVE",
        created_by=None,
    )
    db.add(db_obj)
    db.flush()

    db.commit()
    db.refresh(db_obj)

    # Confirm to the visitor without echoing the full record: id, name,
    # member_code (always null until approval) and the pending status.
    return {
        "message": "Registration received. It will be visible after the sabha approves it.",
        "member_id": db_obj.id,
        "member_code": db_obj.member_code,
        "approval_status": db_obj.approval_status,
    }



from fastapi.responses import Response
from io import BytesIO

@router.get("/export-labels")
def export_labels(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    pincode_id: Optional[int] = None,
    membership_type_id: Optional[int] = None,
) -> Response:
    """Generate a printable PDF of member address labels."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    
    query = db.query(Member).filter(Member.is_deleted == False, Member.member_status == "ACTIVE")

    if state_id:
        query = query.filter(Member.state_id == state_id)
    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)
    if pincode_id:
        query = query.filter(Member.pincode_id == pincode_id)
    if membership_type_id:
        from models.members import MemberMembership
        query = query.join(MemberMembership, Member.id == MemberMembership.member_id).filter(
            MemberMembership.membership_type_id == membership_type_id,
            MemberMembership.status == "ACTIVE"
        )

    members = query.all()

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    
    labels_per_row = 3
    labels_per_col = 8
    
    label_width = width / labels_per_row
    label_height = height / labels_per_col
    
    col = 0
    row = 0
    
    for member in members:
        x = col * label_width + 15
        y = height - ((row + 1) * label_height) + 15
        
        textobject = c.beginText()
        textobject.setTextOrigin(x, y + label_height - 25)
        textobject.setFont("Helvetica-Bold", 10)
        name = member.display_name
        textobject.textLine(name or "Unknown Member")
        
        textobject.setFont("Helvetica", 9)
        if member.address_line1: textobject.textLine(member.address_line1)
        if member.address_line2: textobject.textLine(member.address_line2)
        
        locality_str = [x for x in [member.locality, member.city, member.post] if x]
        if locality_str:
            textobject.textLine(", ".join(locality_str))
            
        c.drawText(textobject)
        
        col += 1
        if col >= labels_per_row:
            col = 0
            row += 1
            if row >= labels_per_col:
                row = 0
                c.showPage()
                
    c.save()
    pdf = buffer.getvalue()
    buffer.close()

    return Response(
        content=pdf, 
        media_type="application/pdf", 
        headers={"Content-Disposition": "attachment; filename=labels.pdf"}
    )

@router.get("/duplicates")
def read_duplicates(
    kind: str = "mobile",          # mobile | name | similar
    search: Optional[str] = None,  # a name, mobile or membership number inside the group
    page: int = 1, limit: int = 20,
    export: Optional[str] = None,  # "excel": every group as one sheet
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.list.read")),
) -> Any:
    """Members who may be the same person: one mobile used by several members, the same name, or names spelled a little differently.
    The page is a slice of the GROUPS (at most 200); nothing is merged or changed."""
    from core.pagination import LIST_PAGE_MAX
    from services import duplicate_members

    try:
        groups = duplicate_members.find_groups(db, kind.lower(), search)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if export:
        return Response(
            content=duplicate_members.groups_xlsx(groups),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=duplicate_members_{kind.lower()}.xlsx"},
        )
    page, limit = max(1, page), max(1, min(limit, LIST_PAGE_MAX))
    total = len(groups)
    return {"groups": groups[(page - 1) * limit: page * limit], "total": total, "page": page, "limit": limit,
            "pages": max(1, -(-total // limit)), "members_in_groups": sum(len(g["members"]) for g in groups)}


@router.get("/duplicate-check")
def duplicate_check(
    mobile: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    dob: Optional[date] = None,
    exclude_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Registration helper: is this person already on file?

    ``same_mobile`` = the live members who use that mobile number (family members may share one, rule 2.2);
    ``similar`` = same first name + last name + date of birth on a different mobile.
    """
    live = [Member.is_deleted == False]  # noqa: E712
    if exclude_id:
        live.append(Member.id != exclude_id)

    def card(m):
        from models.masters import District

        district = db.query(District.name_en).filter(District.id == m.district_id).scalar() if m.district_id else None
        return {
            "id": m.id,
            "name": " ".join(x for x in (m.name_title, m.display_name) if x),
            "member_code": m.member_code,
            "membership_number": m.membership_number,
            "mobile": m.mobile,
            "approval_status": m.approval_status,
            "relation": m.applied_on_behalf_of,
            "district": district,
        }

    digits = re.sub(r"\D", "", mobile or "")[-10:]
    same_mobile = []
    if len(digits) == 10:
        same_mobile = db.query(Member).filter(*live, Member.mobile == digits).limit(10).all()
    similar = []
    if first_name and dob:
        q = db.query(Member).filter(
            *live,
            func.lower(func.trim(Member.first_name_en)) == first_name.strip().lower(),
            Member.date_of_birth == dob,
        )
        if last_name:
            q = q.filter(func.lower(func.trim(func.coalesce(Member.last_name_en, ""))) == last_name.strip().lower())
        similar = [m for m in q.limit(3).all() if m.id not in {x.id for x in same_mobile}]
    return {"same_mobile": [card(m) for m in same_mobile], "similar": [card(m) for m in similar]}


@router.get("/lookup")
def lookup_member(
    number: str = Query(..., description="The member's membership number (never the member id, registration number or mobile)"),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Look a member up by their membership number only. The member id (MID), the registration number and the
    mobile are not membership numbers, so they find nobody."""
    import re
    raw = (number or "").strip()
    if len(raw) < 3 and not raw.isdigit():
        return {"number": raw, "found": False, "matches": [], "member": None}

    ids: list = []

    def add(rows):
        for (mid,) in rows:
            if mid not in ids:
                ids.append(mid)

    upper = raw.upper()
    live = Member.is_deleted == False  # noqa: E712
    add(db.query(Member.id).filter(live, func.upper(Member.member_code) == upper).limit(5))
    add(
        db.query(MemberMembership.member_id)
        .join(Member, Member.id == MemberMembership.member_id)
        .filter(live, MemberMembership.is_deleted == False, func.upper(MemberMembership.membership_number) == upper)  # noqa: E712
        .limit(5)
    )

    members = db.query(Member).filter(live, Member.id.in_(ids[:5])).all() if ids else []
    members.sort(key=lambda m: ids.index(m.id))

    matches = []
    for m in members:
        membership = db.query(MemberMembership).filter(
            MemberMembership.member_id == m.id,
            MemberMembership.is_deleted == False,
        ).order_by(MemberMembership.id.desc()).first()
        full_name = " ".join(p for p in (m.name_title, m.display_name) if p)
        matches.append({
            "id": m.id,
            "name": full_name or m.full_name_kn or f"Member {m.id}",
            "member_code": m.member_code,
            "membership_number": membership.membership_number if membership else None,
            "mobile": m.mobile,
            "gender": m.gender,
            "approval_status": m.approval_status,
            "member_status": m.member_status,
        })

    return {
        "number": raw,
        "found": bool(matches),
        "matches": matches,
        "member": matches[0] if matches else None,
    }


def _import_run_row(run: MemberImportRun, names: dict, detail: bool = False) -> dict:
    out = {
        "id": run.id, "file_name": run.file_name, "total_rows": run.total_rows, "processed_rows": run.processed_rows,
        "success_count": run.success_count, "skipped_count": run.skipped_count, "warning_count": run.warning_count,
        "skip_duplicates": run.skip_duplicates,
        "imported_by": names.get(run.created_by) or "-", "imported_at": run.created_at, "finished_at": run.updated_at or run.created_at,
        "status": "COMPLETED" if run.processed_rows >= run.total_rows else "INCOMPLETE",
    }
    if detail:
        out["skipped"] = run.skipped or []
        out["warnings"] = run.warnings or []
    return out


# ─── DRY RUN OF THE OLD REGISTER (MstMember.xlsx) ───────────────────
# The register has ~32,000 members and ~39,000 receipt lines, so the check runs in the background: the screen starts
# it, asks how far it is, then downloads the reports. Nothing is saved to the member or receipt tables.
def _legacy_dir() -> str:
    path = os.path.join(settings.UPLOAD_DIR, "legacy_reports")
    os.makedirs(path, exist_ok=True)
    return path


def _legacy_status(job_id: str, user: User) -> dict:
    import json
    if not re.fullmatch(r"[0-9a-f]{32}", job_id or ""):
        raise HTTPException(404, "Dry run not found")
    path = os.path.join(_legacy_dir(), f"{job_id}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Dry run not found")
    with open(path, encoding="utf-8") as fh:
        info = json.load(fh)
    if info.get("user_id") != user.id:
        raise HTTPException(404, "Dry run not found")
    return info


def _run_legacy_dry_run(job_id: str, user_id: int, file_name: str, content: bytes) -> None:
    import json
    from db.session import SessionLocal
    from services import legacy_import

    base = os.path.join(_legacy_dir(), job_id)

    def write(info: dict) -> None:
        with open(base + ".json", "w", encoding="utf-8") as fh:
            json.dump({"user_id": user_id, "file_name": file_name, **info}, fh, default=str)

    db = SessionLocal()
    try:
        write({"status": "RUNNING"})
        plan = legacy_import.build_plan(db, legacy_import.read_register(content))
        with open(base + ".xlsx", "wb") as fh:
            fh.write(legacy_import.reports_xlsx(plan))
        write({"status": "DONE", **legacy_import.summary_json(plan)})
    except Exception as exc:  # the screen shows the reason
        write({"status": "FAILED", "error": str(exc)[:500]})
    finally:
        db.rollback()
        db.close()


@router.post("/legacy-import/dry-run")
async def start_legacy_dry_run(
    file: UploadFile = File(...),
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
) -> Any:
    """Check the old register file exactly as its import would judge it and write the reports. Saves no members or
    receipts. Returns a job id: ask GET /legacy-import/dry-run/{job_id} until it is DONE."""
    import threading
    import uuid
    import json

    content = await file.read()
    if not content:
        raise HTTPException(400, "The file is empty")
    job_id = uuid.uuid4().hex
    with open(os.path.join(_legacy_dir(), f"{job_id}.json"), "w", encoding="utf-8") as fh:
        json.dump({"user_id": current_user.id, "file_name": (file.filename or "")[:255], "status": "RUNNING"}, fh)
    threading.Thread(target=_run_legacy_dry_run, args=(job_id, current_user.id, (file.filename or "")[:255], content), daemon=True).start()
    return {"job_id": job_id, "status": "RUNNING"}


@router.get("/legacy-import/dry-run/{job_id}")
def read_legacy_dry_run(
    job_id: str,
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
) -> Any:
    return _legacy_status(job_id, current_user)


@router.get("/legacy-import/dry-run/{job_id}/report")
def download_legacy_dry_run(
    job_id: str,
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
) -> Any:
    from fastapi.responses import FileResponse

    info = _legacy_status(job_id, current_user)
    path = os.path.join(_legacy_dir(), f"{job_id}.xlsx")
    if info.get("status") != "DONE" or not os.path.exists(path):
        raise HTTPException(409, "The reports are not ready yet")
    return FileResponse(path, filename="old_register_dry_run.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/import-history")
def member_import_history(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("members.import.read", "members.import.write", "members.register.write", "members.write")),
    page: int = 1, limit: int = 20,
) -> Any:
    """Every bulk member import, newest first: who ran it, when, which file and the result."""
    q = db.query(MemberImportRun).filter(MemberImportRun.is_deleted == False).order_by(MemberImportRun.id.desc())  # noqa: E712
    data = paginate(q, page, limit, serializer=lambda r: r)
    ids = {r.created_by for r in data["data"] if r.created_by}
    names = {u.id: (u.name or u.username) for u in db.query(User).filter(User.id.in_(ids or {0})).all()}
    data["data"] = [_import_run_row(r, names) for r in data["data"]]
    return data


@router.get("/import-history/{run_id}")
def member_import_history_detail(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("members.import.read", "members.import.write", "members.register.write", "members.write")),
    run_id: int,
) -> Any:
    run = db.query(MemberImportRun).filter(MemberImportRun.id == run_id, MemberImportRun.is_deleted == False).first()  # noqa: E712
    if not run:
        raise HTTPException(404, "Import not found")
    u = db.query(User).filter(User.id == run.created_by).first() if run.created_by else None
    return _import_run_row(run, {u.id: (u.name or u.username)} if u else {}, detail=True)


@router.get("/payment-mismatches")
def payment_mismatches(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.list.read")),
    page: int = 1,
    limit: int = 50,
) -> Any:
    """Approved members whose payments fall short of the price of their type on the date of their latest receipt.
    An old receipt is probably missing: add it on Receipt Entry (a real one with its own date, or an old dummy one)."""
    from models.masters import MembershipType
    from services import membership_credit

    checks = {k: v for k, v in membership_credit.payment_check_rows(db).items() if v["mismatch"]}
    ids = sorted(checks, key=lambda m: -checks[m]["shortfall"])
    total = len(ids)
    page = max(page, 1)
    limit = min(max(limit, 1), 200)
    window = ids[(page - 1) * limit: page * limit]
    members = {m.id: m for m in db.query(Member).filter(Member.id.in_(window)).all()} if window else {}
    names = {t.id: t.name_en for t in db.query(MembershipType).all()}
    rows = []
    for mid in window:
        m, c = members.get(mid), checks[mid]
        if not m:
            continue
        rows.append({
            "member_id": mid, "name": " ".join(p for p in (m.name_title, m.display_name) if p),
            "membership_number": m.membership_number, "mobile": m.mobile,
            "type_name": names.get(c["type_id"]), "reference_date": c["reference_date"], "no_receipt": c["no_receipt"],
            "price_then": c["price_then"], "paid": c["paid"], "shortfall": c["shortfall"],
        })
    return {"total": total, "page": page, "limit": limit, "data": rows}


@router.get("/{id}")
def read_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    data = schemas_members.Member.model_validate(member).model_dump(mode="json")
    _attach_places(db, [data])  # the popup gets state / district / taluk names with the member, in the same call
    return data

@router.get("/{id}/family", response_model=List[schemas_members.MemberFamilyLink])
def read_member_family(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    family_chain = []
    
    def _format_name(m):
        return m.full_name_kn or m.display_name
        
    if member.member_code:
        linked = db.query(Member).filter(
            or_(
                Member.father_membership_number == member.member_code,
                Member.mother_membership_number == member.member_code,
                Member.spouse_membership_number == member.member_code
            ),
            Member.is_deleted == False
        ).all()
        for lnk in linked:
            rel = "DEPENDENT"
            if lnk.father_membership_number == member.member_code or lnk.mother_membership_number == member.member_code:
                rel = "CHILD"
            elif lnk.spouse_membership_number == member.member_code:
                rel = "SPOUSE"
            family_chain.append({
                "id": lnk.id,
                "member_code": lnk.member_code,
                "name": _format_name(lnk),
                "relationship": rel
            })
            
    parents_spouses = []
    if getattr(member, "father_membership_number", None):
        parents_spouses.append((member.father_membership_number, "FATHER"))
    if getattr(member, "mother_membership_number", None):
        parents_spouses.append((member.mother_membership_number, "MOTHER"))
    if getattr(member, "spouse_membership_number", None):
        parents_spouses.append((member.spouse_membership_number, "SPOUSE"))
        
    for code, rel in parents_spouses:
        rel_m = db.query(Member).filter(Member.member_code == code, Member.is_deleted == False).first()
        if rel_m:
            family_chain.append({
                "id": rel_m.id,
                "member_code": rel_m.member_code,
                "name": _format_name(rel_m),
                "relationship": rel
            })
            
    my_memberships = db.query(MemberMembership).filter(MemberMembership.member_id == id).all()
    my_mem_numbers = [m.membership_number for m in my_memberships if m.membership_number]
    if my_mem_numbers:
        deps = db.query(Member).join(MemberMembership).filter(
            MemberMembership.family_membership_number.in_(my_mem_numbers),
            Member.is_deleted == False
        ).all()
        for d in deps:
            if not any(f["id"] == d.id for f in family_chain):
                family_chain.append({
                    "id": d.id,
                    "member_code": d.member_code,
                    "name": _format_name(d),
                    "relationship": "DEPENDENT"
                })
                
    return family_chain

@router.get("/{id}/services", response_model=List[schemas_members.MemberServiceOptin])
def read_member_services(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    services_list = []
    optins = db.query(MemberServiceOptin, ServiceType).join(
        ServiceType, MemberServiceOptin.service_type_id == ServiceType.id
    ).filter(
        MemberServiceOptin.member_id == id,
        MemberServiceOptin.is_deleted == False
    ).all()
    for optin, stype in optins:
        services_list.append({
            "id": optin.id,
            "member_id": optin.member_id,
            "service_type_id": optin.service_type_id,
            "status": optin.status,
            "opted_at": optin.opted_at,
            "opted_via": optin.opted_via,
            "linked_type": optin.linked_type,
            "linked_id": optin.linked_id,
            "notes": optin.notes,
            "service_code": stype.code,
            "service_name_en": stype.name_en,
            "service_name_kn": stype.name_kn,
        })
    return services_list

@router.get("/{id}/donations", response_model=List[schemas_members.MemberDonation])
def read_member_donations(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    from models.receipts import ReceiptAllocation, Receipt
    donations_list = []
    allocs = db.query(ReceiptAllocation, Receipt).join(
        Receipt, ReceiptAllocation.receipt_id == Receipt.id
    ).filter(
        ReceiptAllocation.member_id == id,
        ReceiptAllocation.is_deleted == False,
        Receipt.is_deleted == False
    ).all()
    for alloc, rec in allocs:
        donations_list.append({
            "receipt_id": rec.id,
            "receipt_number": rec.receipt_number,
            "receipt_date": rec.receipt_date,
            "amount": alloc.allocated_amount,
            "purpose": rec.receipt_type
        })
    return donations_list

@router.put("/{id}", response_model=Union[schemas_members.Member, PendingApproval])
@approval_gate.gated("members", "UPDATE", "Member", "members.write")
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

    # Mangalya-parity personal master references must exist.
    _member_master_checks(db, data)

    new_type_id = data.pop("membership_type_id", None)
    if new_type_id:
        _change_membership_type(db, member, new_type_id, current_user.id)
    if any(k in data for k in ("magazine_needed", "magazine_delivery_address", "magazine_kind", "magazine_email")):
        merged = {
            "magazine_kind": data.get("magazine_kind", member.magazine_kind),
            "magazine_email": data.get("magazine_email", member.magazine_email),
            "magazine_delivery_address": data.get("magazine_delivery_address", member.magazine_delivery_address),
        }
        needed = data.get("magazine_needed", member.magazine_needed)
        _magazine_choice(merged, needed=needed, own_email=data.get("email", member.email))
        data.update(merged)
    updated = crud_members.member.update(db=db, db_obj=member, obj_in=data, updated_by=current_user.id)
    if any(k in data for k in ("magazine_needed", "magazine_delivery_address", "magazine_kind", "magazine_email")):
        from services.magazine_subscriptions import sync_member_magazine_subscription
        sync_member_magazine_subscription(
            db,
            updated,
            magazine_needed=data.get("magazine_needed"),
            delivery_address=data.get("magazine_delivery_address"),
            user_id=current_user.id,
        )
        db.commit()
        db.refresh(updated)
    return updated


def _change_membership_type(db: Session, member: Member, new_type_id: int, user_id: int) -> None:
    """Editing a member's membership type changes the type on their membership record (what the profile and the
    lists read) and leaves a line in the type history; with no membership record yet, one is created."""
    from models.masters import MembershipType
    from models.members import MembershipTypeHistory
    from services.pricing import active_price

    if not db.query(MembershipType.id).filter(MembershipType.id == new_type_id, MembershipType.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=400, detail="Unknown membership_type_id")
    price_row = active_price(db, new_type_id)
    now = datetime.now(timezone.utc)
    current = (
        db.query(MemberMembership)
        .filter(MemberMembership.member_id == member.id, MemberMembership.is_deleted == False)  # noqa: E712
        .order_by(MemberMembership.id.desc()).first()
    )
    if current is None:
        current = MemberMembership(
            member_id=member.id, membership_type_id=new_type_id, price_id=price_row.id if price_row else None,
            status="ACTIVE" if member.approval_status == "APPROVED" else "PENDING", applied_at=now, created_by=user_id,
        )
        db.add(current)
        db.flush()
        old_type_id, old_price = None, None
    else:
        if current.membership_type_id == new_type_id:
            return
        old_row = active_price(db, current.membership_type_id)
        old_type_id, old_price = current.membership_type_id, (float(old_row.amount) if old_row else None)
        current.membership_type_id = new_type_id
        current.price_id = price_row.id if price_row else None
        current.updated_by = user_id
    db.add(MembershipTypeHistory(
        member_id=member.id, membership_id=current.id, old_type_id=old_type_id, new_type_id=new_type_id,
        old_price=old_price, new_price=float(price_row.amount) if price_row else 0,
        changed_by=user_id, changed_at=now, reason="Changed while editing the member", created_by=user_id,
    ))


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


def _location_names(db: Session, member: Member) -> dict:
    """State / district / taluk / PIN names for the profile screen (the member row only holds ids)."""
    from models.masters import District, PostalCode, State, Taluk

    def name(model, pk, attr="name_en"):
        if not pk:
            return None
        row = db.query(model).filter(model.id == pk).first()
        return getattr(row, attr, None) if row else None

    return {
        "state_name": name(State, member.state_id),
        "district_name": name(District, member.district_id),
        "taluk_name": name(Taluk, member.taluk_id),
        "pincode": name(PostalCode, member.pincode_id, "pincode"),
    }


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
                "name": ref.full_name_kn or ref.display_name,
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
    current_user: User = Depends(deps.require_permission("members.write")),
    background_tasks: BackgroundTasks,
    id: int,
    reason: Optional[str] = Query(None, description="Approval reason or note"),
) -> Any:
    """Approve a member and auto-assign membership number."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Shared activation core with POST /receipts/{id}/activate-member so the
    # two entry points can never drift.
    from services.member_activation import activate_member
    member = activate_member(db, member, activated_by=current_user.id, reason=reason)

    db.commit()
    db.refresh(member)

    # Spec: notification on membership activation (template based). The
    # MEMBERSHIP_ACTIVATION template is looked up by purpose; approval must
    # not fail when it is missing or the member has no mobile number.
    _queue_activation_notification(db, background_tasks, member, activated_by=current_user.id)
    return member


@router.put("/{id}/reject")
def reject_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.unapproved.write")),
    id: int,
    reason: str = Query(..., min_length=1, description="Why the meeting said Disagree"),
) -> Any:
    """Disagree in the meeting: the applicant becomes REJECTED (never gets a membership number). Their receipts go
    back to Unassigned so they can be mapped to someone else. /reopen brings them back to Unapproved."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.approval_status != "UNAPPROVED":
        raise HTTPException(status_code=409, detail=f"Only an unapproved applicant can be rejected (this one is {member.approval_status})")
    from services import receipt_status
    now = datetime.now(timezone.utc)
    unassigned = receipt_status.unassign_member_receipts(db, id, current_user.id, at=now)
    member.approval_status = "REJECTED"
    member.updated_by = current_user.id
    db.add(MemberApprovalHistory(
        member_id=id, action="REJECT", old_status="UNAPPROVED", new_status="REJECTED",
        reason=reason.strip(), acted_by=current_user.id, acted_at=now, created_by=current_user.id,
    ))
    db.commit()
    return {"message": "Application rejected", "member_id": id, "unassigned_receipts": unassigned}


@router.put("/{id}/reopen")
def reopen_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.unapproved.write")),
    id: int,
    reason: str = Query(..., min_length=1, description="Why the application is taken up again"),
) -> Any:
    """A rejected applicant goes back to Unapproved, to be assigned a receipt and decided on again."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.approval_status != "REJECTED":
        raise HTTPException(status_code=409, detail="Only a rejected applicant can be re-opened")
    now = datetime.now(timezone.utc)
    member.approval_status = "UNAPPROVED"
    member.updated_by = current_user.id
    db.add(MemberApprovalHistory(
        member_id=id, action="REOPEN", old_status="REJECTED", new_status="UNAPPROVED",
        reason=reason.strip(), acted_by=current_user.id, acted_at=now, created_by=current_user.id,
    ))
    db.commit()
    return {"message": "Application re-opened", "member_id": id}


class MeetingExportBody(pydantic.BaseModel):
    member_ids: List[int] = pydantic.Field(min_length=1, max_length=5000)


@router.post("/meeting-export")
def export_meeting_pdf(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.unapproved.read")),
    body: MeetingExportBody,
) -> Any:
    """The PDF the committee takes to the meeting: one row per unapproved applicant given, with an empty Decision
    column. Every applicant on it is logged with today's date (the screens filter on that). Nothing is blocked."""
    import uuid
    from fastapi.responses import Response
    from fpdf import FPDF
    from fpdf.enums import Align
    from core.pagination import _to_plain
    from models.members import MemberMeetingExport

    members = (
        db.query(Member)
        .filter(Member.id.in_(set(body.member_ids)), Member.is_deleted == False, Member.approval_status == "UNAPPROVED")  # noqa: E712
        .order_by(Member.created_at.asc(), Member.id.asc()).all()
    )
    if not members:
        raise HTTPException(status_code=404, detail="None of these applicants is awaiting approval")
    rows = [_to_plain(m, set()) for m in members]
    _attach_membership_types(db, rows)
    _attach_latest_receipts(db, rows)

    today = date.today()
    ref = uuid.uuid4().hex[:20]
    for m in members:
        db.add(MemberMeetingExport(member_id=m.id, exported_on=today, export_ref=ref, created_by=current_user.id))
    db.commit()

    fonts = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "assets", "fonts")
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_title(f"Applicants for the meeting {today:%d-%m-%Y}")
    pdf.add_font("Mtg", "", os.path.join(fonts, "NotoSans-Regular.ttf"))
    pdf.add_font("Mtg", "B", os.path.join(fonts, "NotoSans-Bold.ttf"))
    pdf.add_font("MtgKn", "", os.path.join(fonts, "NotoSansKannada-Regular.ttf"))
    pdf.add_font("MtgKn", "B", os.path.join(fonts, "NotoSansKannada-Bold.ttf"))
    pdf.set_fallback_fonts(["MtgKn"])
    pdf.set_text_shaping(True)
    pdf.set_margins(10, 10, 10)
    pdf.set_auto_page_break(True, margin=12)
    pdf.add_page()
    pdf.set_font("Mtg", "B", 14)
    pdf.cell(0, 8, f"Applicants for approval - meeting list ({today:%d-%m-%Y})", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Mtg", "", 9)
    pdf.cell(0, 6, f"{len(rows)} applicant{'s' if len(rows) != 1 else ''}. Decision: tick Agree or Disagree.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Mtg", "", 8.5)
    with pdf.table(col_widths=(10, 14, 62, 28, 34, 44, 34, 51), text_align=Align.L, line_height=5.2) as table:
        head = table.row()
        for h in ("#", "ID", "Name", "Mobile", "Membership", "Place", "Receipt", "Decision"):
            head.cell(h)
        for i, r in enumerate(rows, 1):
            name = r.get("full_name_en") or " ".join(p for p in (r.get("first_name_en"), r.get("middle_name_en"), r.get("last_name_en")) if p)
            if r.get("full_name_kn"):
                name = f"{name}\n{r['full_name_kn']}"
            place = ", ".join(str(x) for x in (r.get("city") or r.get("locality"), r.get("district_name")) if x)
            rc = r.get("receipt")
            receipt = f"{rc['receipt_number']}\n{rc['receipt_date'] or ''}" if rc else "Not assigned"
            row = table.row()
            for v in (str(i), str(r["id"]), name, r.get("mobile") or "-", r.get("membership_type") or "-", place or "-", receipt,
                      "[  ] Agree     [  ] Disagree"):
                row.cell(v)
    return Response(
        content=bytes(pdf.output()), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="meeting-list-{today:%Y-%m-%d}.pdf"', "X-Export-Date": today.isoformat()},
    )


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
        "name": member.display_name,
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
@approval_gate.gated("members", "CREATE", "MemberMembership", "members.write")
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
        family_membership_number=membership_in.family_membership_number,
        created_by=current_user.id,
    )
    if member.approval_status == "APPROVED":
        from services.member_activation import membership_number_for
        obj.membership_number = membership_number_for(db, member)
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
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
    file: UploadFile = File(...),
) -> Any:
    """Upload member photo."""
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    # One folder per member (by primary key); only the current photo is kept.
    folder = f"images/members/{member.id}"
    meta = await save_upload(file, subfolder=folder, filename="photo", allowed_types=IMAGE_TYPES)
    for old in glob.glob(os.path.join(settings.UPLOAD_DIR, folder, "photo.*")):
        if os.path.abspath(old) != os.path.abspath(meta["file_path"]):
            os.remove(old)
    member.photo_path = meta["file_path"].replace("\\", "/")
    member.updated_by = current_user.id
    db.commit()
    return {"photo_path": meta["file_path"]}

@router.post("/documents/", response_model=schemas_members.MemberDocument)
# Not @approval_gate.gated: an UploadFile's bytes can't be captured into a
# JSON payload and replayed later.
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

@router.put("/documents/{doc_id}", response_model=Union[schemas_members.MemberDocument, PendingApproval])
@approval_gate.gated("members", "UPDATE", "MemberDocument", "members.write", id_param="doc_id")
def verify_member_document(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
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
@approval_gate.gated("members", "DELETE", "MemberDocument", "members.delete", id_param="doc_id")
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
            body=f"{current_user.name} requested to delete member {id}. Reason: {reason}",
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
        unassigned = _purge_member(db, id)
        db.commit()
        return {"message": _deleted_message("Member permanently deleted", unassigned), "member_id": id, "reason": reason,
                "mode": "PERMANENT", "unassigned_receipts": unassigned}

    from services import receipt_status
    unassigned = receipt_status.unassign_member_receipts(db, id, current_user.id, at=now)  # their receipts wait for another member
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
    return {"message": _deleted_message("Member deleted", unassigned), "member_id": id, "reason": reason, "mode": "SOFT",
            "unassigned_receipts": unassigned}


def _deleted_message(base: str, unassigned: list) -> str:
    if not unassigned:
        return base
    shown = ", ".join(str(n) for n in unassigned[:5]) + (" ..." if len(unassigned) > 5 else "")
    return f"{base}. {len(unassigned)} receipt{'s' if len(unassigned) != 1 else ''} ({shown}) went back to Unassigned and can be mapped to another member."


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
@approval_gate.gated("members", "CREATE", "MemberServiceOptin", "members.write", id_param="id")
def create_service_optin(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
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
    _create_granted: User = Depends(deps.require_permission("members.write")),
    current_user: User = Depends(deps.require_permission("members.write")),
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
@approval_gate.gated("members", "UPDATE", "MemberServiceOptin", "members.write", id_param="optin_id")
def update_service_optin(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
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


@router.get("/{id}/membership-credit")
def read_membership_credit(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
    include: Optional[str] = None,
) -> Any:
    """What the member has paid toward membership, which type that buys, and
    what is left over for the next one (see services/membership_credit).

    `include` (comma separated receipt types) previews the result for a
    different selection of ticked types without saving anything or
    upgrading the member."""
    from services import membership_credit
    if not crud_members.member.get(db=db, id=id):
        raise HTTPException(status_code=404, detail="Member not found")
    types = None
    if include is not None:
        try:
            types = membership_credit.parse_types(include)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    return membership_credit.summary(db, id, types)


@router.post("/{id}/membership-credit/recalculate")
def recalculate_membership_credit(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
) -> Any:
    """Re-run the auto-upgrade for one member (e.g. after correcting receipts
    or changing the membership prices). Only ever upgrades."""
    from services import membership_credit
    if not crud_members.member.get(db=db, id=id):
        raise HTTPException(status_code=404, detail="Member not found")
    change = membership_credit.apply_auto_upgrade(db, id, current_user.id)
    db.commit()
    return {"changed": change, **membership_credit.summary(db, id)}


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
            "old_membership_number": member.old_membership_number,   # the number the old register gave
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
            **{
                c.name: getattr(member, c.name)
                for c in Member.__table__.columns
                if c.name not in ("is_deleted", "deleted_by", "deleted_at")
            },
            "member_code": member.membership_number,  # the same number, under its old name
            **_location_names(db, member),
        },
        "memberships": membership_list,
        "membership_credit": __import__("services.membership_credit", fromlist=["summary"]).summary(db, id),
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
                    "delivery_kind": member.magazine_kind,
                    "delivery_email": member.magazine_email,
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

# ── Member profile, one tab at a time ──────────────────────────────────────
# GET /members/{id}/profile/{section} returns only that tab's data, so the screen loads what is open and nothing
# else. "summary" is the header (name, photo, status, credit and a count for each tab).
PROFILE_SECTIONS = (
    "summary", "overview", "personal", "contact", "family", "membership", "receipts", "magazine", "services", "events", "history",
)


def _profile_summary(db: Session, member: Member) -> dict:
    from models.events import EventMemberLink, EventParticipant
    from models.magazines import MagazineSubscription
    from models.masters import MembershipType
    from models.members import MembershipTypeHistory
    from models.receipts import Receipt, ReceiptAllocation
    from services import membership_credit

    mid = member.id
    active = (
        db.query(MemberMembership, MembershipType)
        .join(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(MemberMembership.member_id == mid, MemberMembership.is_deleted == False)  # noqa: E712
        .order_by((MemberMembership.status == "ACTIVE").desc(), MemberMembership.applied_at.desc())
        .first()
    )
    receipt_count = (
        db.query(func.count(ReceiptAllocation.id))
        .filter(ReceiptAllocation.member_id == mid, ReceiptAllocation.is_deleted == False)  # noqa: E712
        .scalar() or 0
    )
    magazine_count = (
        db.query(func.count(MagazineSubscription.id))
        .filter(MagazineSubscription.member_id == mid, MagazineSubscription.is_deleted == False)  # noqa: E712
        .scalar() or 0
    ) + (
        db.query(func.count(MemberServiceOptin.id))
        .filter(MemberServiceOptin.member_id == mid, MemberServiceOptin.is_deleted == False,  # noqa: E712
                MemberServiceOptin.status == "ACTIVE")
        .scalar() or 0
    )
    event_count = (
        db.query(func.count(EventMemberLink.id)).filter(EventMemberLink.member_id == mid).scalar() or 0
    ) + (
        db.query(func.count(EventParticipant.id))
        .filter(EventParticipant.member_id == mid, EventParticipant.is_deleted == False)  # noqa: E712
        .scalar() or 0
    )
    services_count = (
        db.query(func.count(MemberServiceOptin.id))
        .filter(MemberServiceOptin.member_id == mid, MemberServiceOptin.is_deleted == False,  # noqa: E712
                MemberServiceOptin.status == "ACTIVE")
        .scalar() or 0
    )
    membership_count = (
        db.query(func.count(MemberMembership.id))
        .filter(MemberMembership.member_id == mid, MemberMembership.is_deleted == False)  # noqa: E712
        .scalar() or 0
    )
    family_count = sum(
        1 for v in (member.father_name or member.father_husband_name, member.mother_name, member.spouse_name) if v
    ) + len(member.children_details or [])
    mm, mt = active if active else (None, None)
    return {
        "id": member.id,
        "member_code": member.member_code,
        "name_title": member.name_title,
        "first_name_en": member.first_name_en,
        "middle_name_en": member.middle_name_en,
        "last_name_en": member.last_name_en,
        "full_name_kn": member.full_name_kn,
        "approval_status": member.approval_status,
        "member_status": member.member_status,
        "mobile": member.mobile,
        "mobile_country_code": member.mobile_country_code,
        "photo_path": member.photo_path,
        "locality": member.locality,
        "city": member.city,
        "post": member.post,
        "active_membership": {
            "type_name_en": mt.name_en, "type_name_kn": mt.name_kn, "status": mm.status,
            "membership_number": mm.membership_number,
        } if mm else None,
        "membership_credit": membership_credit.summary(db, mid),
        "counts": {
            "family": family_count,
            "membership": membership_count,
            "receipts": receipt_count,
            "magazine": magazine_count,
            "services": services_count,
            "events": event_count,
        },
    }


def _profile_personal(db: Session, member: Member) -> dict:
    masters = _member_master_details(db, member)
    pick = lambda key: (masters.get(key) or {}).get("name_en")  # noqa: E731
    return {
        "name_title": member.name_title,
        "first_name_en": member.first_name_en,
        "middle_name_en": member.middle_name_en,
        "last_name_en": member.last_name_en,
        "full_name_kn": member.full_name_kn,
        "gender": member.gender,
        "date_of_birth": member.date_of_birth,
        "blood_group": member.blood_group,
        "is_married": member.is_married,
        "gotra": pick("gotra"),
        "qualification": pick("qualification"),
        "native_place": pick("native_place"),
        "occupation": member.occupation,
        "designation": member.designation,
        "category": member.category,
        "company": member.company,
        "website": member.website,
        "aadhaar_number": member.aadhaar_number,
        "remarks": member.remarks,
        "registration_source": member.registration_source,
        "member_status": member.member_status,
        "approval_status": member.approval_status,
        "applied_on_behalf_of": member.applied_on_behalf_of,
        "mobile_owner_name": member.mobile_owner_name,
        "whatsapp_owner_relation": member.whatsapp_owner_relation,
        "whatsapp_owner_name": member.whatsapp_owner_name,
        "created_at": member.created_at,
    }


def _profile_contact(db: Session, member: Member) -> dict:
    return {
        "mobile": member.mobile,
        "mobile_country_code": member.mobile_country_code,
        "whatsapp_number": member.whatsapp_number,
        "whatsapp_country_code": member.whatsapp_country_code,
        "alternate_mobile": member.alternate_mobile,
        "email": member.email,
        "address_line1": member.address_line1,
        "address_line2": member.address_line2,
        "native_address": member.native_address,
        "native_same_as_current": bool(member.native_same_as_current),
        "address_line1_kn": member.address_line1_kn,
        "address_line2_kn": member.address_line2_kn,
        "locality": member.locality,
        "locality_kn": member.locality_kn,
        "area": member.area,
        "place": member.place,
        "grama": member.grama,
        "village": member.village,
        "post": member.post,
        "city": member.city,
        "label_point": member.label_point,
        "address_remarks": member.address_remarks,
        "country": member.country,
        **_location_names(db, member),
    }


def _profile_family(db: Session, member: Member) -> dict:
    masters = _member_master_details(db, member)
    return {
        "father_name": member.father_name or member.father_husband_name,
        "father_membership_number": member.father_membership_number,
        "mother_name": member.mother_name,
        "mother_membership_number": member.mother_membership_number,
        "is_married": member.is_married,
        "spouse_name": member.spouse_name,
        "spouse_membership_number": member.spouse_membership_number,
        "has_children": member.has_children,
        "children": member.children_details or [],
        "family_membership_number": member.family_membership_number,
        "family_membership_name": member.family_membership_name,
        "referred_by_number": member.referred_by_number,
        "referred_by_name": member.referred_by_name,
        "referred_by": masters.get("referred_by"),
    }


def _actor_namer(db: Session, current_user: User):
    """id -> name of the user who did something, for the profile tabs. An account ranked above the viewer shows as System."""
    hidden = deps.stronger_user_ids(db, current_user)
    cache: dict = {}

    def name(uid):
        if not uid:
            return None
        if uid in hidden:
            return "System"
        if uid not in cache:
            u = db.query(User).filter(User.id == uid).first()
            cache[uid] = (u.name or u.username) if u else None
        return cache[uid]

    return name


def _payment_check_view(db: Session, member_id: int):
    from models.masters import MembershipType
    from services import membership_credit

    c = membership_credit.payment_check_rows(db, [member_id]).get(member_id)
    if not c:
        return None
    t = db.get(MembershipType, c["type_id"])
    return {**c, "type_name": t.name_en if t else None}


def _profile_membership(db: Session, member: Member, actor=None) -> dict:
    actor = actor or (lambda _uid: None)
    from models.masters import MembershipType
    from models.members import MembershipTypeHistory
    from services import membership_credit

    mid = member.id
    rows = (
        db.query(MemberMembership, MembershipType)
        .join(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(MemberMembership.member_id == mid, MemberMembership.is_deleted == False)  # noqa: E712
        .order_by(MemberMembership.applied_at.desc())
        .all()
    )
    memberships = []
    for m, t in rows:
        price = active_price(db, t.id)
        memberships.append({
            "id": m.id, "membership_type_id": t.id, "type_code": t.code, "type_name_en": t.name_en,
            "type_name_kn": t.name_kn, "membership_number": m.membership_number, "old_membership_number": member.old_membership_number, "status": m.status,
            "applied_at": m.applied_at, "activated_at": m.activated_at, "expires_at": m.expires_at,
            "family_membership_number": m.family_membership_number,
            "current_price": float(price.amount) if price else None,
        })
    names = {t.id: t.name_en for t in db.query(MembershipType).all()}
    changes = (
        db.query(MembershipTypeHistory)
        .filter(MembershipTypeHistory.member_id == mid)
        .order_by(MembershipTypeHistory.changed_at.desc())
        .all()
    )
    from models.receipts import Receipt

    receipt_nos = {
        r.id: r.receipt_number
        for r in db.query(Receipt).filter(Receipt.id.in_([h.receipt_id for h in changes if h.receipt_id])).all()
    } if any(h.receipt_id for h in changes) else {}
    return {
        "memberships": memberships,
        "payment_check": _payment_check_view(db, mid),
        "payments": membership_credit.payment_table(db, mid),
        "approval": {
            "status": member.approval_status,
            "registered_at": member.created_at, "registered_by": actor(member.created_by),
            "approved_at": member.approved_at, "approved_by": actor(member.approved_by),
        },
        "membership_credit": membership_credit.summary(db, mid),
        "type_changes": [
            {
                "old_type": names.get(h.old_type_id), "new_type": names.get(h.new_type_id),
                "old_price": float(h.old_price) if h.old_price is not None else None,
                "new_price": float(h.new_price) if h.new_price is not None else None,
                "receipt_id": h.receipt_id, "receipt_number": receipt_nos.get(h.receipt_id),
                "changed_at": h.changed_at, "changed_by": actor(h.changed_by), "reason": h.reason,
            }
            for h in changes
        ],
    }


def _profile_receipts(db: Session, member: Member, page: int, limit: int) -> dict:
    from models.receipts import Receipt, ReceiptAllocation

    q = (
        db.query(ReceiptAllocation, Receipt)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(ReceiptAllocation.member_id == member.id, ReceiptAllocation.is_deleted == False)  # noqa: E712
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
    )
    total = q.count()
    rows = q.offset((page - 1) * limit).limit(limit).all()
    return {
        "total": total, "page": page, "limit": limit,
        "data": [
            {
                "receipt_id": r.id, "receipt_number": r.receipt_number, "receipt_date": r.receipt_date,
                "receipt_type": r.receipt_type, "net_amount": float(r.net_amount),
                "payment_status": r.payment_status, "payment_mode": r.payment_mode,
                "allocated_amount": float(a.allocated_amount),
                "transaction_reference": r.transaction_reference, "bank_account": r.bank_account,
                "transaction_date": r.transaction_date, "cheque_number": r.cheque_number, "cheque_date": r.cheque_date,
                "discount_amount": float(r.discount_amount or 0), "receipt_status": r.receipt_status,
                "period_from_date": r.period_from_date, "period_to_date": r.period_to_date, "notes": r.notes,
            }
            for a, r in rows
        ],
    }


def _profile_service_usage(db: Session, member: Member) -> dict:
    """Services the member has actually *used*, derived from their assigned receipts.

    A receipt line counts when its particular is tied to a service
    (particulars.service_type_id, master setup). We never guess by name. The
    member's share of a partially-allocated receipt is applied to each line
    (allocated_amount / net_amount), so the figures stay honest. Cancelled and
    soft-deleted receipts/items are skipped.
    """
    from models.masters import Particular
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem

    rows = (
        db.query(Receipt, ReceiptItem, Particular, ServiceType, ReceiptAllocation)
        .join(ReceiptItem, ReceiptItem.receipt_id == Receipt.id)
        .join(Particular, Particular.id == ReceiptItem.particular_id)
        .join(ServiceType, ServiceType.id == Particular.service_type_id)
        .join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
        .filter(
            ReceiptAllocation.member_id == member.id,
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            ReceiptItem.is_deleted == False,  # noqa: E712
            Receipt.is_deleted == False,  # noqa: E712
            Receipt.receipt_status != "CANCELLED",
            Particular.is_deleted == False,  # noqa: E712
            Particular.service_type_id.isnot(None),
            ServiceType.is_deleted == False,  # noqa: E712
        )
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
        .all()
    )

    detail = []
    summary: dict = {}
    for receipt, item, particular, service, allocation in rows:
        net = float(receipt.net_amount or 0)
        allocated = float(allocation.allocated_amount or 0)
        share = (allocated / net) if net > 0 else 1.0
        amount = round(float(item.amount or 0) * share, 2)
        detail.append({
            "service_code": service.code,
            "service_name_en": service.name_en,
            "service_name_kn": service.name_kn,
            "receipt_id": receipt.id,
            "receipt_number": receipt.receipt_number,
            "receipt_date": receipt.receipt_date,
            "particular_name": item.particular_name or particular.name_en,
            "description": item.description,
            "amount": amount,
        })
        bucket = summary.setdefault(service.code, {
            "service_code": service.code,
            "service_name_en": service.name_en,
            "service_name_kn": service.name_kn,
            "times": 0,
            "total_amount": 0.0,
            "last_used": None,
        })
        bucket["times"] += 1
        bucket["total_amount"] = round(bucket["total_amount"] + amount, 2)
        if receipt.receipt_date and (bucket["last_used"] is None or receipt.receipt_date > bucket["last_used"]):
            bucket["last_used"] = receipt.receipt_date

    summary = sorted(summary.values(), key=lambda x: x["total_amount"], reverse=True)
    return {"usage": detail, "usage_summary": summary}


def _issue_history(db: Session, sub) -> list:
    from api.v1.endpoints.magazines import build_subscription_history

    return build_subscription_history(db, sub)


def _subscription_log(db: Session, member: Member, actor) -> list:
    """When the magazine was started, stopped or restarted and its address changed, from the member activity log."""
    from models.activity import MemberActivityLog

    out = []
    rows = (
        db.query(MemberActivityLog)
        .filter(MemberActivityLog.member_id == member.id, MemberActivityLog.is_deleted == False)  # noqa: E712
        .order_by(MemberActivityLog.created_at.desc(), MemberActivityLog.id.desc())
        .limit(500)
        .all()
    )
    for r in rows:
        d = r.details or {}
        if d.get("entity_type") != "magazine_subscriptions":
            continue
        changes = d.get("changes") or {}
        if r.action == "CREATE":
            what = "Magazine subscription started"
        elif "delivery_status" in changes:
            c = changes["delivery_status"]
            what = f"Delivery changed from {c.get('from') or '-'} to {c.get('to') or '-'}"
        elif "address_override" in changes:
            what = "Delivery address changed"
        else:
            continue
        out.append({"at": r.created_at, "by": actor(r.user_id), "what": what, "reason": d.get("reason")})
    return out


def _profile_magazine(db: Session, member: Member, actor=None) -> dict:
    actor = actor or (lambda _uid: None)
    from models.magazines import MagazineReturn, MagazineSubscription
    from models.members import MemberKycRequest

    latest_kyc = (
        db.query(MemberKycRequest)
        .filter(MemberKycRequest.member_id == member.id, MemberKycRequest.is_deleted == False)  # noqa: E712
        .order_by(MemberKycRequest.sent_at.desc())
        .first()
    )
    subs = (
        db.query(MagazineSubscription)
        .filter(MagazineSubscription.member_id == member.id, MagazineSubscription.is_deleted == False)  # noqa: E712
        .all()
    )
    ids = [x.id for x in subs]
    returns = (
        db.query(MagazineReturn)
        .filter(MagazineReturn.subscription_id.in_(ids), MagazineReturn.is_deleted == False)  # noqa: E712
        .order_by(MagazineReturn.return_date.desc())
        .all()
        if ids else []
    )
    from models.magazines import MagazineDeliveryPause
    from api.v1.endpoints.magazines import _member_label_address

    pauses = (
        db.query(MagazineDeliveryPause)
        .filter(MagazineDeliveryPause.subscription_id.in_(ids), MagazineDeliveryPause.is_deleted == False)  # noqa: E712
        .order_by(MagazineDeliveryPause.pause_start_date.desc())
        .all()
        if ids else []
    )
    opted = (
        db.query(MemberServiceOptin, ServiceType)
        .join(ServiceType, ServiceType.id == MemberServiceOptin.service_type_id)
        .filter(MemberServiceOptin.member_id == member.id, MemberServiceOptin.is_deleted == False,  # noqa: E712
                MemberServiceOptin.status == "ACTIVE")
        .order_by(ServiceType.name_en)
        .all()
    )
    return {
        "magazine_needed": member.magazine_needed,
        "magazine_delivery_address": getattr(member, "magazine_delivery_address", None),
        "magazine_kind": member.magazine_kind,
        "magazine_email": member.magazine_email,
        "member_address": _member_label_address(member),
        "subscription_log": _subscription_log(db, member, actor),
        "issues": [i for sub in subs for i in _issue_history(db, sub)],
        "subscriptions": [
            {"id": x.id, "delivery_status": x.delivery_status, "address_override": x.address_override, "notes": x.notes,
             "started_on": x.created_at, "started_by": actor(x.created_by)}
            for x in subs
        ],
        "pauses": [
            {"id": p.id, "subscription_id": p.subscription_id, "pause_start_date": p.pause_start_date,
             "pause_end_date": p.pause_end_date, "reason": p.reason,
             "recorded_by": actor(p.created_by), "recorded_at": p.created_at}
            for p in pauses
        ],
        "returns": [
            {"id": r.id, "subscription_id": r.subscription_id, "issue_month_year": r.issue_month_year,
             "return_date": r.return_date, "return_reason": r.return_reason, "follow_up_status": r.follow_up_status,
             "recorded_by": actor(r.created_by), "recorded_at": r.created_at}
            for r in returns
        ],
        "services": [
            {"id": o.id, "service_code": t.code, "service_name_en": t.name_en, "status": o.status,
             "opted_at": o.opted_at, "opted_via": o.opted_via, "notes": o.notes}
            for o, t in opted
        ],
        **_profile_service_usage(db, member),
        "kyc": (
            {"id": latest_kyc.id, "status": latest_kyc.status, "sent_at": latest_kyc.sent_at,
             "expires_at": latest_kyc.expires_at, "submitted_at": latest_kyc.submitted_at}
            if latest_kyc else None
        ),
    }


def _profile_services(db: Session, member: Member) -> dict:
    """The tab the spec calls 'service opted details': every service this member is
    opted into (with status and when), the service types still available to opt
    into, and what they have actually used (receipt-sourced)."""
    optins = (
        db.query(MemberServiceOptin)
        .filter(MemberServiceOptin.member_id == member.id, MemberServiceOptin.is_deleted == False)  # noqa: E712
        .order_by(MemberServiceOptin.opted_at.desc())
        .all()
    )
    opted_type_ids = {o.service_type_id for o in optins}
    available = (
        db.query(ServiceType)
        .filter(ServiceType.is_deleted == False)  # noqa: E712
        .order_by(ServiceType.name_en)
        .all()
    )
    return {
        "optins": [_optin_payload(db, o) for o in optins],
        "available": [
            {"id": st.id, "code": st.code, "name_en": st.name_en, "name_kn": st.name_kn}
            for st in available if st.id not in opted_type_ids or any(
                o.service_type_id == st.id and o.status == "CANCELLED" for o in optins
            )
        ],
        **_profile_service_usage(db, member),
    }


def _profile_events(db: Session, member: Member) -> dict:
    from models.events import Event, EventMemberLink, EventParticipant

    links = (
        db.query(EventMemberLink, Event)
        .join(Event, Event.id == EventMemberLink.event_id)
        .filter(EventMemberLink.member_id == member.id)
        .order_by(Event.event_date.desc())
        .all()
    )
    guests = (
        db.query(EventParticipant, Event)
        .join(Event, Event.id == EventParticipant.event_id)
        .filter(EventParticipant.member_id == member.id, EventParticipant.is_deleted == False,  # noqa: E712
                Event.is_deleted == False)  # noqa: E712
        .order_by(Event.event_date.desc())
        .all()
    )
    return {
        "events": [{"event_id": e.id, "title": e.title, "event_date": e.event_date, "end_date": e.end_date,
                    "location": e.location, "role": l.role} for l, e in links],
        "guests_and_honours": [
            {"event_id": e.id, "event_title": e.title, "event_date": e.event_date, "end_date": e.end_date,
             "location": e.location,
             "participant_type": p.participant_type, "role": p.participant_role,
             "honoured_as": p.participant_role if p.participant_type == "HONOURED" else None}
            for p, e in guests
        ],
    }


def _profile_history(db: Session, member: Member, actor=None) -> dict:
    actor = actor or (lambda _uid: None)
    from models.members import MemberProfileHistory

    changes = (
        db.query(MemberProfileHistory)
        .filter(MemberProfileHistory.member_id == member.id)
        .order_by(MemberProfileHistory.changed_at.desc())
        .limit(100)
        .all()
    )
    approvals = (
        db.query(MemberApprovalHistory)
        .filter(MemberApprovalHistory.member_id == member.id, MemberApprovalHistory.is_deleted == False)  # noqa: E712
        .order_by(MemberApprovalHistory.acted_at.desc())
        .all()
    )
    return {
        "profile_changes": [
            {"field": h.field_name, "old_value": h.old_value, "new_value": h.new_value,
             "changed_at": h.changed_at, "changed_by": actor(h.changed_by)}
            for h in changes
        ],
        "approvals": [
            {**{c.name: getattr(a, c.name) for c in MemberApprovalHistory.__table__.columns}, "acted_by_name": actor(a.acted_by)}
            for a in approvals
        ],
    }


def _profile_overview(db: Session, member: Member, current_user: User) -> dict:
    """The key facts from the other tabs on one screen: nothing more than the Overview cards show."""
    from api.v1.endpoints.activity import read_member_timeline

    personal = _profile_personal(db, member)
    contact = _profile_contact(db, member)
    family = _profile_family(db, member)
    membership = _profile_membership(db, member)
    magazine = _profile_magazine(db, member)
    recent = _profile_receipts(db, member, 1, 3)
    timeline = read_member_timeline(db=db, current_user=current_user, member_id=member.id, page=1, limit=5)
    current = next((m for m in membership["memberships"] if m["status"] == "ACTIVE"), None) or (
        membership["memberships"][0] if membership["memberships"] else None
    )
    address = ", ".join(
        str(v) for v in (
            contact["address_line1"], contact["address_line2"], contact["locality"], contact["city"],
            contact["taluk_name"], contact["district_name"], contact["state_name"], contact["pincode"],
        ) if v
    )
    return {
        "basic": {k: personal[k] for k in (
            "gender", "date_of_birth", "blood_group", "gotra", "qualification", "occupation", "designation", "native_place")},
        "contact": {
            "mobile": contact["mobile"], "mobile_country_code": contact["mobile_country_code"],
            "whatsapp_number": contact["whatsapp_number"], "whatsapp_country_code": contact["whatsapp_country_code"],
            "email": contact["email"], "address": address,
        },
        "membership": {"current": current, "credit": membership["membership_credit"]},
        "family": {
            "father_name": family["father_name"], "father_membership_number": family["father_membership_number"],
            "mother_name": family["mother_name"], "mother_membership_number": family["mother_membership_number"],
            "spouse_name": family["spouse_name"], "spouse_membership_number": family["spouse_membership_number"],
            "children_count": len(family["children"]),
        },
        "receipts": {"total": recent["total"], "latest": recent["data"]},
        "magazine": {
            "magazine_needed": magazine["magazine_needed"],
            "magazine_delivery_address": magazine.get("magazine_delivery_address"),
            "subscriptions": [x["delivery_status"] for x in magazine["subscriptions"]],
            "services": [x["service_name_en"] for x in magazine["services"]],
        },
        "activity": [
            {"id": e["id"], "description": (e.get("details") or {}).get("description") or e.get("action"),
             "acted_by_name": e.get("acted_by_name"), "created_at": e.get("created_at")}
            for e in timeline["data"]
        ],
    }


@router.get("/{id}/profile/{section}")
def read_member_profile_section(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
    section: str,
    page: int = 1,
    limit: int = 20,
) -> Any:
    """One tab of the member profile (summary, personal, contact, family, membership, receipts, magazine, events,
    history). The activity timeline has its own call: GET /activity/members/{id}/timeline."""
    if section not in PROFILE_SECTIONS:
        raise HTTPException(status_code=404, detail="Unknown profile section")
    member = crud_members.member.get(db=db, id=id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    if section == "receipts":
        return _profile_receipts(db, member, page, limit)
    if section == "overview":
        return _profile_overview(db, member, current_user)
    builders = {
        "summary": _profile_summary, "personal": _profile_personal, "contact": _profile_contact,
        "family": _profile_family, "membership": _profile_membership, "magazine": _profile_magazine,
        "services": _profile_services, "events": _profile_events, "history": _profile_history,
    }
    if section in ("membership", "magazine", "history"):
        return builders[section](db, member, _actor_namer(db, current_user))
    return builders[section](db, member)


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
        body=f"{current_user.name} requested a profile change for member {req_in.member_id}.",
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
    current_user: User = Depends(deps.require_permission("members.write")),
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
                         "members.write", {"id": id}, "id")


# ─── BULK MEMBER IMPORT ──────────────────────────────────────────

class BulkMemberImportRow(pydantic.BaseModel):
    membership_number: str
    first_name_en: str
    middle_name_en: Optional[str] = None
    last_name_en: Optional[str] = None
    full_name_kn: Optional[str] = None
    mobile: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    email: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    locality: Optional[str] = None
    city: Optional[str] = None
    gotra: Optional[str] = None
    pincode: Optional[str] = None
    membership_type: Optional[str] = None
    remarks: Optional[str] = None

class BulkMemberImportPayload(pydantic.BaseModel):
    members: List[BulkMemberImportRow]
    skip_duplicates: bool = True
    # the screen sends a file in batches: these tie the batches to one line in the import history
    run_id: Optional[str] = pydantic.Field(default=None, max_length=40)
    file_name: Optional[str] = pydantic.Field(default=None, max_length=255)
    total_rows: Optional[int] = None


def _record_import_run(db: Session, user: User, *, run_id: Optional[str], file_name: Optional[str], total_rows: Optional[int],
                       batch_rows: int, created: int, skipped: list, skip_duplicates: bool, warnings: Optional[list] = None) -> None:
    """Add one batch to its run in the import history (the run is created by the first batch)."""
    import uuid
    run_id = (run_id or uuid.uuid4().hex)[:40]
    run = db.query(MemberImportRun).filter(MemberImportRun.run_id == run_id).first()
    if not run:
        run = MemberImportRun(run_id=run_id, file_name=file_name, total_rows=total_rows or batch_rows, processed_rows=0,
                              success_count=0, skipped_count=0, skip_duplicates=skip_duplicates, skipped=[], warnings=[],
                              warning_count=0, created_by=user.id)
        db.add(run)
    elif run.created_by != user.id:
        return  # someone else's run id: never add to it
    run.processed_rows += batch_rows
    run.success_count += created
    run.skipped_count += len(skipped)
    run.skipped = ((run.skipped or []) + skipped)[:200]
    run.warning_count = (run.warning_count or 0) + len(warnings or [])
    run.warnings = ((run.warnings or []) + (warnings or []))[:200]


def _clean_import_name(raw: Optional[str]) -> str:
    """Collapse runs of spaces and drop stray punctuation at the ends (a trailing comma or backtick)."""
    name = re.sub(r"\s+", " ", str(raw or "")).strip()
    name = name.replace("`", "").replace("\u2019", "'")
    return name.strip(" ,;:-_/\\").strip()


def _clean_import_mobile(raw: Optional[str]) -> tuple:
    """(mobile, warning). A 10-digit Indian mobile is kept; +91 / 91 / spaces / dashes are dropped. A landline
    (starts with 0 / an STD code), a foreign number or any other length is left blank, with a warning."""
    text = str(raw or "").strip()
    if not text:
        return None, None
    digits = re.sub(r"\D", "", text)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 10 and digits[0] in "6789":
        return digits, None
    if digits.startswith("0") or "-" in text:
        return None, f"'{text}' looks like a landline, so the mobile was left blank"
    return None, f"'{text}' is not a valid mobile number, so it was left blank"


_NO_GOTRA = {"", "NA", "N/A", "NONE", "NIL", "UNKNOWN", "-", "--"}


def _gotra_key(raw: Optional[str]) -> str:
    """One key for the many spellings of a gotra (VASISHTA, VASHISHTA, VASISTA... / VISHWAMITRA, VISHWAMITHRA... /
    GOWTAMA, GOUTHAMA...): letters only, AU as OU, W as U, no H, doubled letters once, E as I, no final A."""
    k = re.sub(r"[^A-Z]", "", str(raw or "").upper()).replace("AU", "OU").replace("W", "U").replace("H", "")
    k = re.sub(r"(.)\1+", r"\1", k).replace("E", "I")
    return k[:-1] if k.endswith("A") else k


# Misspellings seen in the legacy register that the spelling key alone cannot reach -> the gotra they mean.
_GOTRA_ALIASES = {
    "Vashishta": ["VSISHTA", "VASISAHTA", "VASHITA", "VASJHISTHA", "VASHIATHA", "VSISTATA"],
    "VISHWAMITRA": ["VISHVAMITRA", "VISHWMITRA", "VISHWAMITHA", "VISHWMATRA", "VISEAMITRA", "VISHAWAMITRA", "VISHEMITRA",
                    "VISHWAMAITHRA", "VISMAMITRA", "VISHWAMTHRA", "VISHVAMITHRA"],
    "Kashyapa": ["KASHYPA", "KAISHIPA", "KASHIPA", "KAHYAPA", "KASAHYAPA", "KASHAPA"],
    "Jamadagni": ["JAMADGNI", "JAMDAGNI", "JAMADGI", "JAMADGHNI", "GAMADAGNI"],
    "Gowtama": ["GUTHAMA", "GOUTHMA"],
    "Bharadwaja": ["BAHRADWA", "JBHARADWAJ"],
    "Mouna Bhargava": ["MOUNBHARGHAVA"],
}
_GOTRA_ALIAS_KEYS = {_gotra_key(alias): _gotra_key(real) for real, aliases in _GOTRA_ALIASES.items() for alias in aliases}


def _run_bulk_import(db: Session, current_user: User, payload: "BulkMemberImportPayload", *, dry_run: bool = False) -> dict:
    """Shared by the real import and the validate-only check. Every row is judged on its own: a bad row is
    skipped (or its bad field left blank) and the rest carry on."""
    from models.masters import MembershipType

    # Cache active membership types
    m_types = db.query(MembershipType).filter(MembershipType.is_deleted == False).all()  # noqa: E712
    default_m_type_id = m_types[0].id if m_types else None
    default_m_type_name = m_types[0].name_en if m_types else "Life Member"
    type_lookup = {mt.name_en.strip().upper(): mt.id for mt in m_types}
    type_lookup.update({mt.code.strip().upper(): mt.id for mt in m_types if mt.code})

    # Load existing membership numbers for deduplication
    existing_nums = set(
        num.strip().upper()
        for (num,) in db.query(MemberMembership.membership_number)
        .filter(MemberMembership.is_deleted == False, MemberMembership.membership_number != None)  # noqa: E711, E712
        .all()
    )
    # the number is also the member's member_code, which must stay unique
    existing_nums |= {
        c.strip().upper()
        for (c,) in db.query(Member.member_code).filter(Member.member_code != None).all()  # noqa: E711
    }

    # members already holding a mobile that appears in this batch (one query for the whole batch)
    batch_mobiles = {m for m in (_clean_import_mobile(i.mobile)[0] for i in payload.members) if m}
    holders: dict = {}
    if batch_mobiles:
        for mobile, code, first, middle, last in (
            db.query(Member.mobile, Member.member_code, Member.first_name_en, Member.middle_name_en, Member.last_name_en)
            .filter(Member.mobile.in_(batch_mobiles), Member.is_deleted == False)  # noqa: E712
            .all()
        ):
            holders.setdefault(mobile, []).append((code, " ".join(x for x in (first, middle, last) if x).upper()))

    # the Gotra master, looked up by the spelling-proof key
    from models.masters import Gotra
    gotras = {}
    for g in db.query(Gotra).filter(Gotra.is_deleted == False, Gotra.status == True).all():  # noqa: E712
        gotras.setdefault(_gotra_key(g.name_en), g)

    # postal codes master, looked up by 6-digit pincode
    from models.masters import PostalCode
    batch_pins = {str(i.pincode).strip() for i in payload.members if i.pincode and str(i.pincode).strip()}
    postal_codes = {}
    if batch_pins:
        for pc in db.query(PostalCode).filter(PostalCode.pincode.in_(batch_pins), PostalCode.is_deleted == False).all():  # noqa: E712
            postal_codes.setdefault(pc.pincode.strip(), pc)

    created_count = 0
    skipped = []
    warnings = []
    now = datetime.now(timezone.utc)

    for item in payload.members:
        num = str(item.membership_number or "").strip()
        if not num:
            skipped.append({"membership_number": "", "reason": "Missing membership number"})
            continue
        if len(num) > 30:
            skipped.append({"membership_number": num[:30], "reason": "Membership number is longer than 30 characters"})
            continue
        if num.upper() in existing_nums:
            if payload.skip_duplicates:
                skipped.append({"membership_number": num, "reason": "Already exists in database or earlier in this file"})
                continue
            else:
                raise HTTPException(409, f"Duplicate membership number '{num}'")

        first_name = _clean_import_name(item.first_name_en)
        last_name = _clean_import_name(item.last_name_en) or None
        middle_name = _clean_import_name(item.middle_name_en) or None
        if first_name and not last_name and not middle_name and " " in first_name:
            # one Full Name in the file: split exactly as the Register Member screen does (first word, middle words, last word)
            parts = first_name.split(" ")
            first_name, middle_name, last_name = parts[0], (" ".join(parts[1:-1]) or None), parts[-1]
        if not first_name:
            skipped.append({"membership_number": num, "reason": "Missing name"})
            continue
        if len(first_name) > 100 or (last_name and len(last_name) > 100):
            skipped.append({"membership_number": num, "reason": "Name is longer than 100 characters"})
            continue
        row_warnings = []

        # mobile: cleaned; a family may share one number, so a shared mobile is allowed and only flagged
        mobile, mobile_warning = _clean_import_mobile(item.mobile)
        mobile_raw = None
        if mobile_warning:
            row_warnings.append(mobile_warning)
            mobile_raw = str(item.mobile).strip()[:50]  # kept so the office can correct it later
        if mobile and mobile in holders:
            same_name = [c for c, n in holders[mobile] if n == " ".join(x for x in (first_name, middle_name, last_name) if x).upper()]
            if same_name:
                row_warnings.append(f"Same name and mobile as member {same_name[0]}: possible duplicate person, please check")
            else:
                row_warnings.append(f"Mobile is shared with {len(holders[mobile])} other member(s)")

        # gotra: matched to the master whatever the spelling; "GENERAL" / blank means none; an unknown one is left blank
        gotra_id, gotra_text = None, None
        raw_gotra = _clean_import_name(item.gotra)
        if raw_gotra.upper() not in _NO_GOTRA:
            gkey = _gotra_key(raw_gotra)
            master = gotras.get(_GOTRA_ALIAS_KEYS.get(gkey, gkey))
            if master:
                gotra_id, gotra_text = master.id, master.name_en
            else:  # not a gotra of the master: left blank (a wrong gotra is worse than none); the note says what the file had
                row_warnings.append(f"Gotra '{raw_gotra}' is not in the Gotra master, so it was left blank")

        # Resolve membership type
        mt_id = default_m_type_id
        if item.membership_type:
            mt_key = str(item.membership_type).strip().upper()
            if mt_key in type_lookup:
                mt_id = type_lookup[mt_key]
            else:
                row_warnings.append(f"Membership type '{item.membership_type}' not found, used '{default_m_type_name}'")

        if not mt_id:
            fallback = db.query(MembershipType).first()
            if not fallback:
                fallback = MembershipType(code="LIFE", name_en="Life Member", status=True)
                db.add(fallback)
                db.flush()
            mt_id = fallback.id

        # gender is never guessed: blank stays blank, M / F are understood, anything else is left blank with a note
        gen = {"M": "MALE", "F": "FEMALE", "O": "OTHER"}.get((item.gender or "").strip().upper(), (item.gender or "").strip().upper())
        if gen not in ("MALE", "FEMALE", "OTHER"):
            if gen:
                row_warnings.append(f"Gender '{item.gender}' is not recognised, so it was left blank")
            gen = None

        # pincode: matched to PostalCode master; fills state/district/taluk if resolved
        pincode_id = None
        state_id = None
        district_id = None
        taluk_id = None
        raw_pin = str(item.pincode or "").strip()
        if raw_pin:
            pc = postal_codes.get(raw_pin)
            if pc:
                pincode_id = pc.id
                state_id = pc.state_id
                district_id = pc.district_id
                taluk_id = pc.taluk_id
            else:
                row_warnings.append(f"PIN Code '{raw_pin}' not found in postal codes master")

        member = Member(
            full_name_en=" ".join(x for x in (first_name, middle_name, last_name) if x),
            first_name_en=first_name,
            middle_name_en=middle_name,
            last_name_en=last_name,
            full_name_kn=item.full_name_kn.strip() if item.full_name_kn else None,
            gender=gen,
            date_of_birth=item.date_of_birth,
            mobile=mobile,
            mobile_raw=mobile_raw,
            gotra_id=gotra_id,
            gotra_text=gotra_text,
            email=item.email.strip() if item.email else None,
            address_line1=item.address_line1.strip() if item.address_line1 else None,
            address_line2=item.address_line2.strip() if item.address_line2 else None,
            locality=item.locality.strip() if item.locality else (item.city.strip() if item.city else None),
            city=item.city.strip() if item.city else None,
            state_id=state_id,
            district_id=district_id,
            taluk_id=taluk_id,
            pincode_id=pincode_id,
            remarks=item.remarks.strip() if item.remarks else None,
            member_code=num,
            approval_status="APPROVED",
            member_status="ACTIVE",
            registration_status="APPROVED",
            registration_source="MIGRATION",
            created_by=current_user.id,
        )
        db.add(member)
        db.flush()

        mm = MemberMembership(
            member_id=member.id,
            membership_type_id=mt_id,
            membership_number=num,
            status="ACTIVE",
            applied_at=now,
            activated_at=now,
            created_by=current_user.id,
        )
        db.add(mm)
        existing_nums.add(num.upper())
        if mobile:  # later rows of the same file see this member as a holder too
            holders.setdefault(mobile, []).append((num, " ".join(x for x in (first_name, middle_name, last_name) if x).upper()))
        for w in row_warnings:
            warnings.append({"membership_number": num, "warning": w})
        created_count += 1

    if dry_run:
        db.rollback()
    else:
        _record_import_run(db, current_user, run_id=payload.run_id, file_name=payload.file_name, total_rows=payload.total_rows,
                           batch_rows=len(payload.members), created=created_count, skipped=skipped,
                           skip_duplicates=payload.skip_duplicates, warnings=warnings)
        db.commit()
    return {
        "success_count": created_count,
        "skipped_count": len(skipped),
        "skipped": skipped[:100],
        "warning_count": len(warnings),
        "warnings": warnings[:100],
        "dry_run": dry_run,
    }


@router.post("/bulk-import/validate")
def validate_bulk_import(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
    payload: "BulkMemberImportPayload",
) -> Any:
    """Check a batch exactly as the import would judge it, without saving anything: what would be imported,
    skipped (and why) and flagged. Nothing is written and nothing is recorded in the import history."""
    return _run_bulk_import(db, current_user, payload, dry_run=True)


@router.post("/bulk-import")
def bulk_import_members(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
    payload: "BulkMemberImportPayload",
) -> Any:
    """Import a batch of existing/live members with their permanent membership numbers."""
    return _run_bulk_import(db, current_user, payload)


def _member_rows_from_upload(content: bytes, filename: str) -> list:
    """The member rows of an uploaded .csv / .txt / .xlsx file (an Excel file saved with a .csv name works too)."""
    import io
    import csv

    filename = (filename or "").lower()
    rows = []
    is_excel = content[:4] == b"PK\x03\x04" or filename.endswith((".xlsx", ".xls"))  # an Excel file saved as .csv is still Excel

    if not is_excel and (filename.endswith((".csv", ".txt")) or not filename):
        text_stream = io.StringIO(content.decode("utf-8", errors="replace"))
        reader = csv.DictReader(text_stream)
        for r in reader:
            rows.append(r)
    elif is_excel:
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content), dtype=str)  # text as typed: 100, not 100.0
            df = df.where(pd.notnull(df), None)
            rows = [
                {k: (None if v is None or (isinstance(v, float) and v != v) else v) for k, v in r.items()}  # blank cells are None, never "nan"
                for r in df.to_dict(orient="records")
            ]
        except Exception as e:
            raise HTTPException(400, f"Could not parse Excel file: {str(e)}")
    else:
        raise HTTPException(400, "Supported formats: .csv, .xlsx, .xls")

    if not rows:
        raise HTTPException(400, "The uploaded file contains no data rows.")

    parsed_members = []
    for raw in rows:
        norm = {str(k).strip().lower().replace(" ", "_"): v for k, v in raw.items() if k is not None}
        
        num = (
            norm.get("membership_number")
            or norm.get("membership_no")
            or norm.get("member_no")
            or norm.get("membership_code")
            or norm.get("member_code")
            or norm.get("no")
        )
        if not num:
            continue

        first_name = (
            norm.get("first_name_en")
            or norm.get("first_name")
            or norm.get("name")
            or norm.get("full_name")
            or norm.get("member_name")
            or norm.get("membership_name")
        )
        if not first_name:
            continue

        last_name = norm.get("last_name_en") or norm.get("last_name")
        first_name_str = str(first_name).strip()  # a full name is split into first / last name by the import itself

        dob = norm.get("date_of_birth") or norm.get("dob")
        dob_parsed = None
        if dob:
            try:
                if isinstance(dob, str):
                    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
                        try:
                            dob_parsed = datetime.strptime(dob.strip(), fmt).date()
                            break
                        except ValueError:
                            pass
                elif hasattr(dob, "date"):
                    dob_parsed = dob.date()
            except Exception:
                dob_parsed = None

        parsed_members.append(
            BulkMemberImportRow(
                membership_number=str(num).strip(),
                first_name_en=first_name_str,
                middle_name_en=str(norm.get("middle_name_en") or "").strip() or None,
                last_name_en=str(last_name).strip() if last_name else None,
                full_name_kn=str(norm.get("full_name_kn") or "").strip() or None,
                mobile=str(norm.get("mobile") or norm.get("phone") or norm.get("mobile_number") or "").strip() or None,
                gotra=str(norm.get("gotra") or norm.get("gothra") or "").strip() or None,
                gender=str(norm.get("gender") or "").strip() or None,
                date_of_birth=dob_parsed,
                email=str(norm.get("email") or "").strip() or None,
                address_line1=str(norm.get("address_line1") or norm.get("address") or "").strip() or None,
                address_line2=str(norm.get("address_line2") or "").strip() or None,
                locality=str(norm.get("locality") or norm.get("place") or norm.get("village") or "").strip() or None,
                city=str(norm.get("city") or norm.get("district") or "").strip() or None,
                pincode=str(norm.get("pincode") or norm.get("postal_code") or "").strip() or None,
                membership_type=str(norm.get("membership_type") or norm.get("type") or "").strip() or None,
                remarks=str(norm.get("remarks") or "").strip() or None,
            )
        )

    if not parsed_members:
        raise HTTPException(400, "Could not identify required columns (Membership No, Name) in the file.")
    return parsed_members


@router.post("/bulk-import/preview")
async def read_import_file(
    file: UploadFile = File(...),
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
) -> Any:
    """Read an uploaded file and hand back its member rows, saving nothing. The import screen uses it for Excel files,
    which the browser cannot read; the rows then go through the same check and import as a CSV."""
    members = _member_rows_from_upload(await file.read(), file.filename or "")
    return {"members": [m.model_dump(mode="json") for m in members], "total": len(members)}


@router.post("/bulk-import-file")
async def bulk_import_members_file(
    file: UploadFile = File(...),
    skip_duplicates: bool = True,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("members.import.write", "members.register.write", "members.write")),
) -> Any:
    """Upload a CSV or Excel file containing live/legacy members to import in bulk."""
    content = await file.read()
    parsed_members = _member_rows_from_upload(content, file.filename or "")
    payload = BulkMemberImportPayload(members=parsed_members, skip_duplicates=skip_duplicates, file_name=(file.filename or "")[:255], total_rows=len(parsed_members))
    return bulk_import_members(db=db, current_user=current_user, payload=payload)
