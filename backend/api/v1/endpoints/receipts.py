from typing import Any, Optional, Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.members import Member, MemberMembership
from models.engagements import Associate
from models.users import User
from models.receipts import (
    PaymentTransaction,
    Receipt,
    ReceiptAllocation,
    ReceiptCancellation,
    RefundTransaction,
)
from schemas import receipts as schemas_receipts
from schemas.common import PendingApproval
from crud import receipts as crud_receipts
from crud.receipts import allocated_total
from core.pagination import paginate
from services.sequences import generate_next_number
from services import approval_gate
from services.exports import render_export
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func, or_
from models.masters import MembershipType

from services import membership_credit

router = APIRouter()

VALID_RECEIPT_TYPES = {
    "MEMBERSHIP",          # membership fee / renewal
    "GENERAL_DONATION",    # unrestricted donation
    "SCHOLARSHIP",         # scholarship fund contribution
    "DONATION",            # (legacy alias of GENERAL_DONATION, still accepted)
    # Funds from the legacy register's receipt grid (Don 1-3, P.Nidhi).
    "DONATION_1", "DONATION_2", "DONATION_3",
    "P_NIDHI",
    "MAGAZINE",
    "EVENT",
    "OTHER",
}
VALID_PAYMENT_MODES = {"CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "OTHER"}


def _validate_enum(value: str, allowed: set, field: str) -> None:
    if value not in allowed:
        raise HTTPException(400, f"{field} must be one of {sorted(allowed)}")


def _get_member_or_404(db: Session, member_id: int) -> Member:
    member = db.query(Member).filter(
        Member.id == member_id, Member.is_deleted == False
    ).first()
    if not member:
        raise HTTPException(400, f"Member {member_id} not found")
    return member


def _validate_membership(db: Session, member_id: int, membership_id: Optional[int]) -> None:
    if membership_id is None:
        return
    link = db.query(MemberMembership).filter(
        MemberMembership.id == membership_id,
        MemberMembership.member_id == member_id,
        MemberMembership.is_deleted == False,
    ).first()
    if not link:
        raise HTTPException(
            400, f"membership_id {membership_id} does not belong to member {member_id}"
        )


def _validate_payee(db: Session, member_id: Optional[int], associate_id: Optional[int]) -> None:
    """Payee must exist; member beats associate if both are somehow given
    (schema already refuses that pair)."""
    if member_id is not None:
        _get_member_or_404(db, member_id)
    elif associate_id is not None:
        associate = db.query(Associate).filter(
            Associate.id == associate_id, Associate.is_deleted == False  # noqa: E712
        ).first()
        if not associate:
            raise HTTPException(400, f"Associate {associate_id} not found")


def _validate_allocation_amount(
    db: Session,
    receipt: Receipt,
    *,
    allocated_amount: float,
    exclude_allocation_id: Optional[int] = None,
) -> None:
    """An allocation cannot push the receipt's total allocation past its net amount."""
    if allocated_amount > float(receipt.net_amount):
        raise HTTPException(
            400,
            f"allocated_amount {allocated_amount} exceeds receipt net_amount {float(receipt.net_amount)}",
        )
    total = allocated_total(db, receipt.id)
    if exclude_allocation_id:
        existing = db.query(ReceiptAllocation).filter(
            ReceiptAllocation.id == exclude_allocation_id, ReceiptAllocation.is_deleted == False
        ).first()
        if existing:
            total -= float(existing.allocated_amount)
    if total + allocated_amount > float(receipt.net_amount) + 0.01:
        raise HTTPException(
            409,
            (
                f"Over-allocation: {total + allocated_amount} would exceed the "
                f"receipt net_amount {float(receipt.net_amount)} "
                f"(already allocated: {total})"
            ),
        )


@router.get("/")
def read_receipts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    payment_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    source: Optional[str] = None,
    member_id: Optional[int] = None,
    is_renewal: Optional[bool] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
) -> Any:
    """Receipt entries with filters; source=ONLINE|OFFLINE, member_id narrows
    to receipts mapped to that member. ``search`` matches payer name,
    receipt number, transaction/cheque reference, or the linked payee's
    name (member or associate)."""
    q = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status: q = q.filter(Receipt.payment_status == payment_status)
    if payment_mode: q = q.filter(Receipt.payment_mode == payment_mode)
    if receipt_type: q = q.filter(Receipt.receipt_type == receipt_type)
    if is_renewal is not None: q = q.filter(Receipt.is_renewal == is_renewal)
    if source:
        if source not in ("ONLINE", "OFFLINE"):
            raise HTTPException(400, "source must be ONLINE or OFFLINE")
        q = q.filter(Receipt.source == source)
    if member_id:
        q = q.join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(
            ReceiptAllocation.member_id == member_id,
            ReceiptAllocation.is_deleted == False,
        ).distinct()
    if from_date: q = q.filter(Receipt.receipt_date >= from_date)
    if to_date: q = q.filter(Receipt.receipt_date <= to_date)
    if search:
        like = f"%{search}%"
        payee_receipt_ids = (
            db.query(ReceiptAllocation.receipt_id)
            .outerjoin(Member, Member.id == ReceiptAllocation.member_id)
            .outerjoin(Associate, Associate.id == ReceiptAllocation.associate_id)
            .filter(
                ReceiptAllocation.is_deleted == False,
                or_(
                    Member.first_name_en.ilike(like),
                    Member.last_name_en.ilike(like),
                    Member.full_name_kn.ilike(like),
                    Member.member_code.ilike(like),
                    Member.mobile.ilike(like),
                    Associate.name.ilike(like),
                ),
            )
        )
        q = q.filter(or_(
            Receipt.payer_name.ilike(like),
            Receipt.receipt_number.ilike(like),
            Receipt.transaction_reference.ilike(like),
            Receipt.cheque_number.ilike(like),
            Receipt.id.in_(payee_receipt_ids),
        ))
    return paginate(q.order_by(Receipt.id.desc()), page, limit)


@router.post("/", response_model=Union[schemas_receipts.Receipt, PendingApproval], status_code=201)
@approval_gate.gated("receipts", "CREATE", "Receipt", "receipts.write")
def create_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    receipt_in: schemas_receipts.ReceiptCreate,
) -> Any:
    """Receipt entry for ONLINE (website/app) and OFFLINE (counter) registrations.

    Optionally maps the receipt to members in the same call via ``allocations``
    — once allocated, the member enters the magazine label print list.
    """
    _validate_enum(receipt_in.receipt_type, VALID_RECEIPT_TYPES, "receipt_type")
    _validate_enum(receipt_in.payment_mode, VALID_PAYMENT_MODES, "payment_mode")

    # Pre-validate payee mappings so the whole entry fails before anything is written.
    inline_total = 0.0
    for alloc in receipt_in.allocations:
        _validate_payee(db, alloc.member_id, alloc.associate_id)
        _validate_membership(db, alloc.member_id, alloc.membership_id)
        inline_total += alloc.allocated_amount
    if inline_total > receipt_in.net_amount + 0.01:
        raise HTTPException(
            409,
            f"Over-allocation: inline allocations total {inline_total} exceeds "
            f"receipt net_amount {receipt_in.net_amount}",
        )

    receipt_no = receipt_in.receipt_number or generate_next_number(db, "RECEIPT", "REC")
    created = crud_receipts.receipt.create_with_items(
        db=db, obj_in=receipt_in, created_by=current_user.id, receipt_number=receipt_no
    )
    if receipt_in.allocations:
        membership_credit.recompute_members(
            db, [a.member_id for a in receipt_in.allocations], current_user.id
        )
        db.commit()
        db.refresh(created)
    return created


@router.get("/tracking")
def read_receipt_tracking(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    year: Optional[int] = None,
    month: Optional[int] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    is_renewal: Optional[bool] = None,
    member_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
    export: Optional[str] = None,  # "csv" or "excel"
) -> Any:
    """Receipt register for the Receipt Tracking screen.

    Use export=csv or export=excel to download the whole filtered register
    (the Tracking screen's Export button); it renders every data row and
    ignores page/limit.

    Every row carries the linked profile (via allocations) — name, member id,
    member_code, membership_number, mobile, approval_status and the
    membership's expiry date — plus a per-payment-mode summary across the
    whole (filtered) register, so the totals bar needs no extra request.
    """
    filters = [
        Receipt.is_deleted == False,            # noqa: E712
        Receipt.payment_status != "CANCELLED",  # cancelled money is not revenue
    ]
    if year:
        filters.append(func.extract("year", Receipt.receipt_date) == year)
    if month:
        filters.append(func.extract("month", Receipt.receipt_date) == month)
    if payment_mode: filters.append(Receipt.payment_mode == payment_mode)
    if receipt_type: filters.append(Receipt.receipt_type == receipt_type)
    if is_renewal is not None: filters.append(Receipt.is_renewal == is_renewal)
    if member_id:
        filters.append(
            Receipt.id.in_(
                db.query(ReceiptAllocation.receipt_id).filter(
                    ReceiptAllocation.member_id == member_id,
                    ReceiptAllocation.is_deleted == False,  # noqa: E712
                )
            )
        )
    if from_date: filters.append(Receipt.receipt_date >= from_date)
    if to_date: filters.append(Receipt.receipt_date <= to_date)
    if search:
        like = f"%{search}%"
        # Payee names live in members/associates via allocations, so search
        # there first and match receipts by id — keeps this composable with
        # the plain filter list above.
        payee_receipt_ids = (
            db.query(ReceiptAllocation.receipt_id)
            .outerjoin(Member, Member.id == ReceiptAllocation.member_id)
            .outerjoin(Associate, Associate.id == ReceiptAllocation.associate_id)
            .filter(
                ReceiptAllocation.is_deleted == False,
                or_(
                    Member.first_name_en.ilike(like),
                    Member.last_name_en.ilike(like),
                    Member.full_name_kn.ilike(like),
                    Member.member_code.ilike(like),
                    Member.mobile.ilike(like),
                    Associate.name.ilike(like),
                ),
            )
        )
        filters.append(or_(
            Receipt.payer_name.ilike(like),
            Receipt.receipt_number.ilike(like),
            Receipt.transaction_reference.ilike(like),
            Receipt.cheque_number.ilike(like),
            Receipt.id.in_(payee_receipt_ids),
        ))

    # Per-mode summary over the SAME filter set, before pagination narrows it.
    mode_summary = dict(
        db.query(Receipt.payment_mode, func.count())
        .filter(*filters)
        .group_by(Receipt.payment_mode)
        .all()
    )
    total = db.query(func.count(Receipt.id)).filter(*filters).scalar()

    rows = (
        db.query(Receipt)
        .filter(*filters)
        .order_by(Receipt.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    receipt_ids = [r.id for r in rows]

    allocs = (
        db.query(ReceiptAllocation, Member, MemberMembership, Associate)
        .outerjoin(Member, Member.id == ReceiptAllocation.member_id)
        .outerjoin(MemberMembership, MemberMembership.id == ReceiptAllocation.membership_id)
        .outerjoin(Associate, Associate.id == ReceiptAllocation.associate_id)
        .filter(
            ReceiptAllocation.receipt_id.in_(receipt_ids) if receipt_ids else False,
            ReceiptAllocation.is_deleted == False,
        )
        .all()
    )
    by_receipt: dict[int, list] = {}
    for alloc, member, membership, associate in allocs:
        by_receipt.setdefault(alloc.receipt_id, []).append((member, membership, associate))

    data = []
    for r in rows:
        links = by_receipt.get(r.id, [])
        first_member, first_membership, first_associate = (links[0] if links else (None, None, None))
        member_name = (
            " ".join(p for p in (first_member.first_name_en, first_member.last_name_en) if p)
            if first_member else None
        )
        data.append({
            "id": r.id,
            "receipt_number": r.receipt_number,
            "receipt_date": r.receipt_date,
            "receipt_type": r.receipt_type,
            "payer_name": r.payer_name,
            "amount": float(r.net_amount),
            "payment_mode": r.payment_mode,
            "payment_status": r.payment_status,
            "transaction_reference": r.transaction_reference,
            "bank_account": r.bank_account,
            "notes": r.notes,
            "cheque_number": r.cheque_number,
            "cheque_date": r.cheque_date,
            "is_renewal": r.is_renewal,
            "source": r.source,
            # Payee columns: a member (profile-linked) or an associate
            # (non-member donor). payee_type tells the UI which detail to open.
            "member_id": first_member.id if first_member else None,
            "member_name": member_name,
            "member_code": first_member.member_code if first_member else None,
            "mobile": first_member.mobile if first_member else None,
            "approval_status": first_member.approval_status if first_member else None,
            "associate_id": first_associate.id if first_associate else None,
            "associate_name": first_associate.name if first_associate else None,
            "payee_name": member_name or (first_associate.name if first_associate else None),
            "membership_id": first_membership.id if first_membership else None,
            "membership_number": first_membership.membership_number if first_membership else None,
            "membership_expiry_date": first_membership.expires_at if first_membership else None,
            "allocation_count": len(links),
        })

    if export:
        return render_export(
            db, current_user, "receipt_tracking", export,
            {
                "year": year, "month": month, "payment_mode": payment_mode,
                "receipt_type": receipt_type, "is_renewal": is_renewal,
                "member_id": member_id, "from_date": from_date, "to_date": to_date,
                "search": search,
            },
            data, "receipt_tracking",
        )

    return {
        "summary": {
            "total_receipts": total,
            "by_payment_mode": mode_summary,
        },
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if limit else 0,
        "data": data,
    }


@router.get("/renewals-due")
def read_renewals_due(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    days_ahead: int = 30,
    include_expired: bool = True,
    export: Optional[str] = None,  # "csv" or "excel"
) -> Any:
    """Renewal worklist: ACTIVE memberships whose expires_at falls within
    ``days_ahead`` days (or already expired when include_expired=true).

    Backs the Receipt Entry screen's UNAPPROVED RENEWAL PAYMENT LIST —
    the operator picks a member here, then records their renewal receipt
    (receipt_type=MEMBERSHIP, is_renewal=true) and allocates it.
    """
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=max(0, days_ahead))
    q = (
        db.query(MemberMembership, Member, MembershipType)
        .join(Member, Member.id == MemberMembership.member_id)
        .outerjoin(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(
            MemberMembership.is_deleted == False,
            MemberMembership.status == "ACTIVE",
            MemberMembership.expires_at.isnot(None),
            Member.is_deleted == False,
        )
    )
    if include_expired:
        q = q.filter(MemberMembership.expires_at <= horizon)
    else:
        q = q.filter(MemberMembership.expires_at >= now, MemberMembership.expires_at <= horizon)

    q = q.order_by(MemberMembership.expires_at.asc())
    total = q.count()
    rows = q.offset((max(1, page) - 1) * limit).limit(min(max(1, limit), 500)).all()

    def _date_only(dt):
        return dt.date() if dt else None

    data = [{
        "membership_id": m.id,
        "member_id": member.id,
        "member_name": " ".join(p for p in (member.first_name_en, member.last_name_en) if p),
        "member_code": member.member_code,
        "mobile": member.mobile,
        "approval_status": member.approval_status,
        "membership_number": m.membership_number,
        "membership_type_id": t.id if t else None,
        "membership_type": t.name_en if t else None,
        "status": m.status,
        "expiry_date": _date_only(m.expires_at),
        "days_to_expiry": (_date_only(m.expires_at) - now.date()).days if m.expires_at else None,
    } for m, member, t in rows]

    if export:
        return render_export(
            db, current_user, "renewals_due", export,
            {"days_ahead": days_ahead, "include_expired": include_expired},
            data, "renewals_due",
        )

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if limit else 0,
        "data": data,
    }


@router.post("/{id}/activate-member")
# entity_type is "MemberActivation", not "Member" — the registry is keyed on
# (module, action, entity_type) and last-wins; reusing "Member" would clobber
# PUT /members/{id}'s replay handler.
@approval_gate.gated("members", "UPDATE", "MemberActivation", "members.write", id_param="id")
def activate_member_from_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.write")),
    id: int,
) -> Any:
    """Activate (approve) the unapproved profile linked to this receipt.

    The offline counter workflow records the money first (Receipt Entry), then
    the operator opens Receipt Tracking and activates the profile that receipt
    was paid against — same mutations as PUT /members/{id}/approve (shared
    core, so member_code and membership numbers are minted identically), just
    reached from the receipt instead of the members worklist. Refuses receipts
    without exactly one linked profile, and profiles already APPROVED.
    """
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")

    allocs = (
        db.query(ReceiptAllocation)
        .filter(
            ReceiptAllocation.receipt_id == id,
            ReceiptAllocation.is_deleted == False,
        )
        .all()
    )
    if not allocs:
        raise HTTPException(
            400, "Receipt has no member allocation; allocate it before activating"
    )
    member_ids = {a.member_id for a in allocs if a.member_id}
    if not member_ids:
        raise HTTPException(
            400,
            "Receipt is allocated to associate(s) only, not a member — "
            "there is no profile to activate",
        )
    if len(member_ids) != 1:
        raise HTTPException(
            400,
            f"Activate expects exactly one linked member, found {len(member_ids)}; "
            f"activate from the members worklist instead",
        )

    member = db.query(Member).filter(
        Member.id == member_ids.pop(), Member.is_deleted == False  # noqa: E712
    ).first()
    if not member:
        raise HTTPException(404, "Linked member not found")
    if member.approval_status == "APPROVED":
        raise HTTPException(409, "Linked member is already approved/active")

    from services.member_activation import activate_member
    member = activate_member(db, member, activated_by=current_user.id)
    db.commit()
    db.refresh(member)

    return {
        "message": "Member activated from receipt",
        "receipt_id": id,
        "member": {
            "id": member.id,
            "member_code": member.member_code,
            "approval_status": member.approval_status,
            "membership_numbers": [
                m.membership_number
                for m in db.query(MemberMembership)
                .filter(
                    MemberMembership.member_id == member.id,
                    MemberMembership.is_deleted == False,  # noqa: E712
                )
                .all()
                if m.membership_number
            ],
        },
    }


@router.get("/allocations")
def read_allocations(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    receipt_id: Optional[int] = None,
    member_id: Optional[int] = None,
) -> Any:
    """Member mappings of receipts (who received which receipt)."""
    q = db.query(ReceiptAllocation).filter(ReceiptAllocation.is_deleted == False)
    if receipt_id: q = q.filter(ReceiptAllocation.receipt_id == receipt_id)
    if member_id: q = q.filter(ReceiptAllocation.member_id == member_id)
    q = q.order_by(ReceiptAllocation.id.desc())
    page_data = paginate(q, page, limit)
    member_ids = {a["member_id"] for a in page_data["data"] if a.get("member_id")}
    associate_ids = {a["associate_id"] for a in page_data["data"] if a.get("associate_id")}
    names, associate_names = {}, {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)
    if associate_ids:
        for a in db.query(Associate).filter(Associate.id.in_(associate_ids)).all():
            associate_names[a.id] = a.name
    for a in page_data["data"]:
        a["member_name"] = names.get(a.get("member_id"))
        a["associate_name"] = associate_names.get(a.get("associate_id"))
        a["payee_name"] = a["member_name"] or a["associate_name"]
    return page_data


@router.get("/{id}", response_model=schemas_receipts.Receipt)
def read_receipt(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_receipts.receipt.get(db, id)
    if not obj: raise HTTPException(404, "Receipt not found")
    return obj


@router.put("/{id}", response_model=Union[schemas_receipts.Receipt, PendingApproval])
@approval_gate.gated("receipts", "UPDATE", "Receipt", "receipts.write")
def update_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    receipt_in: schemas_receipts.ReceiptUpdate,
) -> Any:
    """Manage a receipt entry (correct payer, amounts, mode, notes).

    Amount edits must keep the totals consistent and cannot fall below what
    has already been allocated to members.
    """
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Cancelled receipts cannot be edited")

    data = receipt_in.model_dump(exclude_unset=True)
    gross = data.get("gross_amount", float(receipt.gross_amount))
    discount = data.get("discount_amount", float(receipt.discount_amount))
    net = data.get("net_amount", float(receipt.net_amount))
    if abs(net - (gross - discount)) > 0.01:
        raise HTTPException(400, "net_amount must equal gross_amount - discount_amount")
    if "source" in data and data["source"]:
        _validate_enum(data["source"], {"ONLINE", "OFFLINE"}, "source")
    if "receipt_type" in data and data["receipt_type"]:
        _validate_enum(data["receipt_type"], VALID_RECEIPT_TYPES, "receipt_type")
    if "payment_mode" in data and data["payment_mode"]:
        _validate_enum(data["payment_mode"], VALID_PAYMENT_MODES, "payment_mode")

    net = data.get("net_amount", float(receipt.net_amount))
    allocated = allocated_total(db, receipt.id)
    if net < allocated - 0.01:
        raise HTTPException(
            409,
            f"net_amount {net} is below the already-allocated total {allocated}; "
            f"remove allocations first",
        )
    return crud_receipts.receipt.update(db, db_obj=receipt, obj_in=data, updated_by=current_user.id)


@router.delete("/{id}", response_model=Union[schemas_receipts.Receipt, PendingApproval])
@approval_gate.gated("receipts", "DELETE", "Receipt", "receipts.delete")
def delete_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.delete")),
    id: int,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if allocated_total(db, receipt.id) > 0:
        raise HTTPException(
            409, "Receipt has member allocations; remove them before deleting"
        )
    return crud_receipts.receipt.remove(db, id=id, deleted_by=current_user.id)


@router.post("/{id}/allocate", response_model=Union[schemas_receipts.ReceiptAllocation, PendingApproval], status_code=201)
@approval_gate.gated("receipts", "CREATE", "ReceiptAllocation", "receipts.write")
def allocate_receipt(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.ReceiptAllocationCreate,
) -> Any:
    """Map a created receipt to a payee — a member (optionally their
    membership) or an associate for non-member donors.

    Once mapped to a member, the member enters the magazine label print list
    (generate labels with only_paid=true).
    """
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Cannot allocate a cancelled receipt")

    _validate_payee(db, payload.member_id, payload.associate_id)
    _validate_membership(db, payload.member_id, payload.membership_id)
    _validate_allocation_amount(
        db, receipt, allocated_amount=payload.allocated_amount
    )

    alloc = ReceiptAllocation(
        receipt_id=id,
        member_id=payload.member_id,
        associate_id=payload.associate_id,
        membership_id=payload.membership_id,
        allocated_amount=payload.allocated_amount,
        created_by=current_user.id,
    )
    db.add(alloc)
    db.flush()
    # Payments add up: reaching a membership type's price upgrades the member.
    membership_credit.recompute_members(db, [alloc.member_id], current_user.id)
    db.commit()
    db.refresh(alloc)
    return alloc


@router.get("/{id}/allocations", response_model=list[schemas_receipts.ReceiptAllocationWithMember])
def read_receipt_allocations(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """The member mappings of one receipt."""
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    allocs = (
        db.query(ReceiptAllocation)
        .filter(
            ReceiptAllocation.receipt_id == id,
            ReceiptAllocation.is_deleted == False,
        )
        .order_by(ReceiptAllocation.id)
        .all()
    )
    member_ids = {a.member_id for a in allocs if a.member_id}
    associate_ids = {a.associate_id for a in allocs if a.associate_id}
    names, associate_names = {}, {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)
    if associate_ids:
        for a in db.query(Associate).filter(Associate.id.in_(associate_ids)).all():
            associate_names[a.id] = a.name
    result = []
    for a in allocs:
        item = schemas_receipts.ReceiptAllocationWithMember.model_validate(a)
        item.member_name = names.get(a.member_id)
        item.associate_name = associate_names.get(a.associate_id)
        result.append(item)
    return result


@router.delete("/{id}/allocations/{allocation_id}", response_model=Union[schemas_receipts.ReceiptAllocation, PendingApproval])
@approval_gate.gated("receipts", "DELETE", "ReceiptAllocation", "receipts.delete", id_param="allocation_id")
def remove_allocation(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.delete")),
    id: int,
    allocation_id: int,
) -> Any:
    """Un-map a receipt from a member (e.g. assigned to the wrong member)."""
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    alloc = db.query(ReceiptAllocation).filter(
        ReceiptAllocation.id == allocation_id,
        ReceiptAllocation.receipt_id == id,
        ReceiptAllocation.is_deleted == False,
    ).first()
    if not alloc:
        raise HTTPException(404, "Allocation not found")
    alloc.is_deleted = True
    alloc.deleted_by = current_user.id
    db.commit()
    db.refresh(alloc)
    return alloc


@router.post("/{id}/cancel")
@approval_gate.gated("receipts", "CREATE", "ReceiptCancellation", "receipts.write")
def cancel_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.ReceiptCancellationCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.payment_status == "CANCELLED":
        raise HTTPException(400, "Receipt is already cancelled")

    receipt.payment_status = "CANCELLED"
    receipt.updated_by = current_user.id
    cancellation = ReceiptCancellation(
        receipt_id=id,
        cancelled_by=current_user.id,
        reason=payload.reason,
        created_by=current_user.id,
    )
    db.add(cancellation)
    db.commit()
    return {"message": "Receipt cancelled successfully"}


@router.post("/{id}/refund", response_model=Union[schemas_receipts.RefundTransaction, PendingApproval])
@approval_gate.gated("receipts", "CREATE", "RefundTransaction", "receipts.write")
def create_refund(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.RefundTransactionCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    refund = RefundTransaction(
        receipt_id=id,
        amount=payload.amount,
        status=payload.status,
        refund_reference=payload.refund_reference,
        created_by=current_user.id,
    )
    db.add(refund)
    db.commit()
    db.refresh(refund)
    return refund


@router.post("/{id}/payment-transactions", response_model=Union[schemas_receipts.PaymentTransaction, PendingApproval])
@approval_gate.gated("receipts", "CREATE", "PaymentTransaction", "receipts.write")
def create_payment_transaction(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),
    id: int,
    payload: schemas_receipts.PaymentTransactionCreate,
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    transaction = PaymentTransaction(
        receipt_id=id,
        gateway_reference=payload.gateway_reference,
        status=payload.status,
        amount=payload.amount,
        created_by=current_user.id,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction
