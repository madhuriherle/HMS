from typing import Any, Optional, Union
from core.exceptions import InUseError
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
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
    ReceiptItem,
    RefundTransaction,
)
from schemas import receipts as schemas_receipts
from schemas.common import PendingApproval
from crud import receipts as crud_receipts
from crud.receipts import allocated_total
from core.pagination import paginate
from services import receipt_numbers
from services.sequences import generate_next_number
from services import approval_gate
from services.exports import render_export
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func, or_
from models.masters import MembershipType, Particular

from services import membership_credit, receipt_status

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


def _allocated_member_ids(db: Session, receipt_id: int) -> list:
    return [
        row[0] for row in db.query(ReceiptAllocation.member_id).filter(
            ReceiptAllocation.receipt_id == receipt_id,
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            ReceiptAllocation.member_id != None,  # noqa: E711
        ).all()
    ]


def _sort_receipts(q, sort_by, sort_dir):
    """Newest receipt (entry order) first, or the column the caller asked for."""
    from core.sorting import sort_query
    return sort_query(
        q, sort_by=sort_by, sort_dir=sort_dir, tiebreak=Receipt.id,
        allowed={"id": Receipt.id, "receipt_date": Receipt.receipt_date, "receipt_number": Receipt.receipt_number,
                 "amount": Receipt.net_amount, "payer_name": Receipt.payer_name, "payment_status": Receipt.payment_status},
        newest_first=(Receipt.id.desc(),),
    )


def _validate_lines(db: Session, items, net: float) -> None:
    """Multi-line receipts: every line must reference a real particular and the lines must add up to
    the receipt's net amount. (A single legacy line without a particular id is not cross-checked.)"""
    if not items or (len(items) == 1 and not items[0].particular_id):
        return
    total = round(sum(float(i.amount) for i in items), 2)
    if abs(total - float(net)) > 0.01:
        raise HTTPException(
            400, f"The particular lines add up to {total:.2f} but the receipt amount is {float(net):.2f}"
        )
    ids = {i.particular_id for i in items if i.particular_id}
    if ids:
        found = {p.id for p in db.query(Particular.id).filter(Particular.id.in_(ids))}
        if ids - found:
            raise HTTPException(400, f"Unknown particular id(s): {sorted(ids - found)}")


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
    receipt_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    source: Optional[str] = None,
    member_id: Optional[int] = None,
    is_renewal: Optional[bool] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = None,   # id | receipt_date | receipt_number | amount | payer_name | payment_status
    sort_dir: str = "desc",
) -> Any:
    """Receipt entries with filters; source=ONLINE|OFFLINE, member_id narrows
    to receipts mapped to that member. ``search`` matches payer name,
    receipt number, transaction/cheque reference, or the linked payee's
    name (member or associate)."""
    q = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status: q = q.filter(Receipt.payment_status == payment_status)
    if receipt_status: q = q.filter(Receipt.receipt_status == receipt_status.upper())
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
                    Member.full_name_en.ilike(like),
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
    return paginate(_sort_receipts(q, sort_by, sort_dir), page, limit)


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

    if not receipt_in.is_cancelled:
        _validate_lines(db, receipt_in.items, receipt_in.net_amount)

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

    fy = receipt_numbers.financial_year_for(receipt_in.receipt_date)
    typed = (receipt_in.receipt_number or "").strip()
    from services import numbering
    if typed and numbering.get_format(db, "RECEIPT").allow_manual:
        receipt_numbers.assert_number_free(db, fy, typed)
        receipt_no = typed
        numbering.note_used(db, "RECEIPT", typed, receipt_in.receipt_date)
    else:  # no number typed, or typing is switched off in Number Formats: use the next one in the format
        receipt_no = receipt_numbers.next_receipt_number(db, receipt_in.receipt_date)
    try:
        created = crud_receipts.receipt.create_with_items(
            db=db, obj_in=receipt_in, created_by=current_user.id, receipt_number=receipt_no
        )
    except IntegrityError:  # two people saved the same number at once
        db.rollback()
        raise HTTPException(409, receipt_numbers.duplicate_message(receipt_no, fy))
    if receipt_in.allocations:
        member_ids = [a.member_id for a in receipt_in.allocations if a.member_id]
        if member_ids:
            membership_credit.recompute_members(db, member_ids, current_user.id)
            from services.magazine_subscriptions import ensure_subscription_on_receipt_assigned
            ensure_subscription_on_receipt_assigned(db, member_ids, current_user.id)
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
    receipt_status: Optional[str] = None,  # UNASSIGNED | ASSIGNED | CANCELLED
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
    receipt_id: Optional[int] = None,  # one receipt (the edit screen loads it this way)
    export: Optional[str] = None,  # "csv" or "excel"
    sort_by: Optional[str] = None,   # id | receipt_date | receipt_number | amount | payer_name | payment_status
    sort_dir: str = "desc",
    particular: Optional[str] = None,   # a line's particular, e.g. "Donation"
    sub_type: Optional[str] = None,     # a line's sub type / detail, e.g. "Annadana"
    fy: Optional[str] = None,           # financial year "2025-26" (1 Apr - 31 Mar)
    mode: Optional[str] = None,         # payment mode as shown: "Cash", or the bank/account name
    member_ids: Optional[str] = None,   # comma separated member ids (their receipts), at most 200
    all_rows: bool = False,             # TEMPORARY: lifts the 200 cap for screens not yet moved to server paging
) -> Any:
    """Receipt register for the Receipt Tracking screen.

    At most 200 receipts per request (rule 10.6): the search and every filter run on the whole register in the
    database, the page only shows the slice asked for. ``summary`` holds the counts of the WHOLE filtered set.

    Use export=csv or export=excel to download the whole filtered register
    (the Tracking screen's Export button); it renders every data row and
    ignores page/limit.

    Every row carries the linked profile (via allocations) — name, member id,
    member_code, membership_number, mobile, approval_status and the
    membership's expiry date — plus a per-payment-mode summary across the
    whole (filtered) register, so the totals bar needs no extra request.
    """
    # Cancelled (spoiled) receipts stay listed, with a Cancelled status, but add nothing to the totals.
    filters = [Receipt.is_deleted == False]  # noqa: E712
    from core.pagination import LIST_PAGE_MAX
    page = max(1, page)
    limit = max(1, limit) if all_rows or export else max(1, min(limit, LIST_PAGE_MAX))
    if receipt_id:
        filters.append(Receipt.id == receipt_id)
    if receipt_status:
        filters.append(Receipt.receipt_status == receipt_status.upper())
    if member_ids:
        wanted = [int(x) for x in member_ids.split(",") if x.strip().isdigit()][:LIST_PAGE_MAX]
        filters.append(Receipt.id.in_(
            db.query(ReceiptAllocation.receipt_id).filter(
                ReceiptAllocation.member_id.in_(wanted or [0]), ReceiptAllocation.is_deleted == False,  # noqa: E712
            )
        ))
    if fy:
        try:
            start_year = int(fy.split("-")[0])
        except ValueError:
            raise HTTPException(400, "fy must look like 2025-26")
        filters.append(Receipt.receipt_date >= date(start_year, 4, 1))
        filters.append(Receipt.receipt_date <= date(start_year + 1, 3, 31))
    if mode:
        low = mode.strip().lower()
        filters.append(or_(func.lower(Receipt.payment_mode) == low, func.lower(func.coalesce(Receipt.bank_account, "")) == low))
    if particular:
        filters.append(Receipt.id.in_(
            db.query(ReceiptItem.receipt_id).filter(
                ReceiptItem.is_deleted == False,  # noqa: E712
                or_(func.lower(ReceiptItem.particular_name) == particular.strip().lower(),
                    func.lower(ReceiptItem.item_type) == particular.strip().lower()),
            )
        ))
    if sub_type:
        filters.append(Receipt.id.in_(
            db.query(ReceiptItem.receipt_id).filter(
                ReceiptItem.is_deleted == False, func.trim(ReceiptItem.description) == sub_type.strip(),  # noqa: E712
            )
        ))
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
                    Member.full_name_en.ilike(like),
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
            Receipt.payer_mobile.ilike(like),
            Receipt.payer_membership_no.ilike(like),
            Receipt.id.in_(payee_receipt_ids),
            Receipt.id.in_(
                db.query(ReceiptItem.receipt_id).filter(
                    ReceiptItem.is_deleted == False,  # noqa: E712
                    or_(ReceiptItem.particular_name.ilike(like), ReceiptItem.description.ilike(like)),
                )
            ),
        ))

    # Per-mode summary over the SAME filter set, before pagination narrows it.
    mode_summary = dict(
        db.query(Receipt.payment_mode, func.count())
        .filter(*filters, Receipt.receipt_status != "CANCELLED")
        .group_by(Receipt.payment_mode)
        .all()
    )
    total = db.query(func.count(Receipt.id)).filter(*filters).scalar()
    by_status = dict(
        db.query(Receipt.receipt_status, func.count()).filter(*filters).group_by(Receipt.receipt_status).all()
    )
    total_amount = float(
        db.query(func.coalesce(func.sum(Receipt.net_amount), 0))
        .filter(*filters, Receipt.receipt_status != "CANCELLED").scalar() or 0
    )

    ordered = _sort_receipts(db.query(Receipt).filter(*filters), sort_by, sort_dir)
    rows = (ordered.all() if export else ordered.offset((page - 1) * limit).limit(limit).all())
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
    lines_by_receipt: dict[int, list] = {}
    if receipt_ids:
        for it in (
            db.query(ReceiptItem)
            .filter(ReceiptItem.receipt_id.in_(receipt_ids), ReceiptItem.is_deleted == False)  # noqa: E712
            .order_by(ReceiptItem.receipt_id, ReceiptItem.line_no, ReceiptItem.id)
        ):
            lines_by_receipt.setdefault(it.receipt_id, []).append({
                "id": it.id,
                "item_type": it.item_type,
                "particular_id": it.particular_id,
                "particular": it.particular_name or it.item_type,
                "description": it.description,
                "amount": float(it.amount),
            })

    by_receipt: dict[int, list] = {}
    for alloc, member, membership, associate in allocs:
        by_receipt.setdefault(alloc.receipt_id, []).append((member, membership, associate))

    data = []
    for r in rows:
        links = by_receipt.get(r.id, [])
        first_member, first_membership, first_associate = (links[0] if links else (None, None, None))
        member_name = (
            first_member.display_name
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
            "receipt_status": r.receipt_status,
            "payer_pan": r.payer_pan,
            "payer_mobile": r.payer_mobile,
            "payer_membership_no": r.payer_membership_no,
            "period_from_date": r.period_from_date,
            "period_to_date": r.period_to_date,
            "period_from_time": r.period_from_time.strftime("%H:%M") if r.period_from_time else None,
            "period_to_time": r.period_to_time.strftime("%H:%M") if r.period_to_time else None,
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
            "items": lines_by_receipt.get(r.id, []),
            "items_count": len(lines_by_receipt.get(r.id, [])),
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
            "by_status": {k or "UNASSIGNED": v for k, v in by_status.items()},
            "total_amount": total_amount,
        },
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if limit else 0,
        "data": data,
    }


@router.get("/tracking-options")
def read_receipt_tracking_options(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """What the Receipt Tracking filters offer, read from the whole register: the financial years that have
    receipts, each particular's sub types, and the payment modes in use (a bank account shows by its name)."""
    live = [Receipt.is_deleted == False]  # noqa: E712
    months = db.query(
        func.extract("year", Receipt.receipt_date), func.extract("month", Receipt.receipt_date)
    ).filter(*live).group_by(
        func.extract("year", Receipt.receipt_date), func.extract("month", Receipt.receipt_date)
    ).all()
    years = sorted({int(y) if int(m) >= 4 else int(y) - 1 for y, m in months if y and m}, reverse=True)
    sub_types: dict = {}
    for name, desc in (
        db.query(ReceiptItem.particular_name, ReceiptItem.description)
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .filter(ReceiptItem.is_deleted == False, Receipt.is_deleted == False,  # noqa: E712
                ReceiptItem.description.isnot(None), ReceiptItem.particular_name.isnot(None))
        .distinct().limit(5000).all()
    ):
        d = (desc or "").strip()
        if d and d.lower() != (name or "").strip().lower():
            sub_types.setdefault(name, set()).add(d)
    modes = set()
    for pm, bank in db.query(Receipt.payment_mode, Receipt.bank_account).filter(*live).distinct().all():
        modes.add((bank or "").strip() if (pm or "").upper() in ("NETBANKING", "OTHER") and (bank or "").strip() else (pm or "").title())
    return {
        "financial_years": [f"{y}-{str(y + 1)[-2:]}" for y in years],
        "sub_types": {k: sorted(v) for k, v in sub_types.items()},
        "payment_modes": sorted(m for m in modes if m),
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


def _member_card(db: Session, member: Member, today: date) -> dict:
    """The small card Receipt Entry shows for a member or applicant (never the full profile)."""
    from models.masters import District

    row = (
        db.query(MemberMembership, MembershipType)
        .outerjoin(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(MemberMembership.member_id == member.id, MemberMembership.is_deleted == False)  # noqa: E712
        .order_by(MemberMembership.applied_at.desc(), MemberMembership.id.desc())
        .first()
    )
    membership, mtype = row if row else (None, None)
    district = (
        db.query(District.name_en).filter(District.id == member.district_id).scalar() if member.district_id else None
    )
    last = (
        db.query(Receipt)
        .join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
        .filter(
            ReceiptAllocation.member_id == member.id, ReceiptAllocation.is_deleted == False,  # noqa: E712
            Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
        )
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
        .first()
    )
    valid_till = membership.expires_at.date() if membership and membership.expires_at else None
    year = member.created_at.year if member.created_at else today.year

    warnings = []
    if member.approval_status != "APPROVED":
        warnings.append({"code": "not_approved", "text": "Applicant: not yet approved"})
    if member.member_status != "ACTIVE":
        warnings.append({"code": "inactive", "text": "This member is inactive"})
    if valid_till and valid_till < today:
        warnings.append({"code": "expired", "text": f"Membership expired on {valid_till.strftime('%d-%m-%Y')}"})

    mem_code = (membership.membership_number if membership and membership.membership_number else None) or member.member_code or member.membership_number
    return {
        "id": member.id,
        "kind": "member" if member.approval_status == "APPROVED" else "applicant",
        "name": " ".join(p for p in (member.name_title, member.display_name) if p),
        "member_code": mem_code,
        "membership_number": mem_code,
        "registration_number": str(member.id),
        "membership_type": mtype.name_en if mtype else None,
        "mobile": member.mobile,
        "district": district,
        "approval_status": member.approval_status,
        "member_status": member.member_status,
        "valid_till": valid_till,
        "last_receipt": {
            "receipt_number": last.receipt_number,
            "receipt_date": last.receipt_date,
            "amount": float(last.net_amount),
        } if last else None,
        "warnings": warnings,
    }


@router.get("/next-number")
def next_receipt_number(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    date: Optional[date] = None,
) -> Any:
    """Receipt Entry defaults: the date to start with (last receipt entered, else
    today) and the next free ``YYYY-YY/NNNN`` number for that date's financial year."""
    from services import numbering
    default_date = receipt_numbers.default_entry_date(db)
    on = date or default_date
    fy = receipt_numbers.financial_year_for(on)
    return {
        "default_date": default_date,
        "receipt_date": on,
        "financial_year": fy,
        "receipt_number": receipt_numbers.next_receipt_number(db, on, consume=False),
        "allow_manual": numbering.get_format(db, "RECEIPT").allow_manual,
    }


@router.get("/number-check")
def check_receipt_number(
    number: str,
    date: date,
    exclude_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Receipt Entry asks this while the number is typed: is it free in that date's financial year?

    ``available`` is false when another live receipt already has the number in the year (``existing`` says whose);
    ``matches_format`` only advises whether it looks like the numbers the format in Number Formats makes."""
    from services import numbering

    typed = (number or "").strip()
    fy = receipt_numbers.financial_year_for(date)
    fmt = numbering.get_format(db, "RECEIPT")
    out = {
        "number": typed, "financial_year": fy, "available": True, "existing": None, "message": None,
        "manual_allowed": fmt.allow_manual, "matches_format": True,
        "example": numbering.render(fmt, date, fmt.start_value),
    }
    if not typed:
        return out
    q = db.query(Receipt).filter(Receipt.financial_year == fy, Receipt.receipt_number == typed)
    if exclude_id is not None:
        q = q.filter(Receipt.id != exclude_id)
    found = q.order_by(Receipt.is_deleted).first()  # a live one is reported before one in the Recycle Bin
    if found:
        out["available"] = False
        out["existing"] = {"id": found.id, "payer_name": found.payer_name, "receipt_date": found.receipt_date,
                           "in_recycle_bin": bool(found.is_deleted)}
        out["message"] = receipt_numbers.duplicate_message(typed, fy, in_bin=bool(found.is_deleted))
    out["matches_format"] = bool(numbering._regex(fmt, date).match(typed))
    return out


@router.get("/duplicate-check")
def duplicate_check(
    payer_name: str,
    net_amount: float,
    date: date,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Receipt Entry asks this before saving: same payee + amount + date already on file?"""
    rows = (
        db.query(Receipt)
        .filter(
            Receipt.is_deleted == False,  # noqa: E712
            Receipt.receipt_status != "CANCELLED",
            func.lower(func.trim(Receipt.payer_name)) == payer_name.strip().lower(),
            Receipt.net_amount == net_amount,
            Receipt.receipt_date == date,
        )
        .order_by(Receipt.id.desc())
        .limit(5)
        .all()
    )
    return {"matches": [{"id": r.id, "receipt_number": r.receipt_number, "payment_mode": r.payment_mode} for r in rows]}


@router.get("/day-book")
def day_book(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Collection summary for a day (default today) or a range: by payment mode and by particular."""
    start = from_date or date.today()
    end = to_date or start
    base = [
        Receipt.is_deleted == False,  # noqa: E712
        Receipt.receipt_status != "CANCELLED",
        Receipt.receipt_date >= start,
        Receipt.receipt_date <= end,
    ]
    by_mode = [
        {"payment_mode": m, "count": c, "amount": float(a or 0)}
        for m, c, a in db.query(Receipt.payment_mode, func.count(), func.sum(Receipt.net_amount))
        .filter(*base).group_by(Receipt.payment_mode).order_by(Receipt.payment_mode)
    ]
    label = func.coalesce(ReceiptItem.particular_name, ReceiptItem.item_type)
    by_particular = [
        {"particular": name or "Other", "amount": float(a or 0)}
        for name, a in db.query(label, func.sum(ReceiptItem.amount))
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .filter(*base, ReceiptItem.is_deleted == False)  # noqa: E712
        .group_by(label)
        .order_by(func.sum(ReceiptItem.amount).desc())
    ]
    return {
        "from_date": start, "to_date": end,
        "receipt_count": sum(m["count"] for m in by_mode),
        "total": round(sum(m["amount"] for m in by_mode), 2),
        "by_payment_mode": by_mode,
        "by_particular": by_particular,
    }


@router.get("/{id}/pdf")
def receipt_pdf(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Printable receipt as a PDF (organisation header, particular lines, amount in words)."""
    from fastapi.responses import Response
    from models.system import OrganisationSettings
    from services.receipt_pdf import build_receipt_pdf

    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    items = (
        db.query(ReceiptItem)
        .filter(ReceiptItem.receipt_id == id, ReceiptItem.is_deleted == False)  # noqa: E712
        .order_by(ReceiptItem.line_no, ReceiptItem.id).all()
    )
    lines = [
        {"particular": i.particular_name or i.item_type.replace("_", " ").title(), "description": i.description, "amount": float(i.amount)}
        for i in items
    ] or [{"particular": receipt.receipt_type.replace("_", " ").title(), "description": None, "amount": float(receipt.net_amount)}]
    payee = []
    alloc = (
        db.query(ReceiptAllocation, Member)
        .join(Member, Member.id == ReceiptAllocation.member_id)
        .filter(ReceiptAllocation.receipt_id == id, ReceiptAllocation.is_deleted == False)  # noqa: E712
        .first()
    )
    if alloc and alloc[1].member_code:
        payee.append(f"Membership No.: {alloc[1].member_code}")
    org = db.query(OrganisationSettings).first()
    pdf = build_receipt_pdf(receipt, lines, org, payee)
    safe = (receipt.receipt_number or f"ID-{receipt.id}").replace("/", "-")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="receipt-{safe}.pdf"'})


@router.get("/member-lookup")
def lookup_member_for_receipt(
    number: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Who is this number? Backs the Membership No. box of Receipt Entry.

    Accepts a membership number (e.g. HMS-20261013-000007) only. Matching is exact and ignores case. The member id
    (MID, a bare 7), the registration number (REG-2026-0007) and the mobile are not membership numbers, so they
    find nobody; an applicant who is not approved yet has no membership number.
    """
    import re

    raw = (number or "").strip()
    if len(raw) < 3 and not raw.isdigit():
        return {"number": raw, "found": False, "matches": []}

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
    exact = bool(ids)

    members = db.query(Member).filter(live, Member.id.in_(ids[:8])).all() if ids else []
    members.sort(key=lambda m: ids.index(m.id))
    today = date.today()
    matches = [_member_card(db, m, today) for m in members]
    return {"number": raw, "found": bool(matches), "exact": exact, "matches": matches}


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
            names[m.id] = m.display_name
    if associate_ids:
        for a in db.query(Associate).filter(Associate.id.in_(associate_ids)).all():
            associate_names[a.id] = a.name
    for a in page_data["data"]:
        a["member_name"] = names.get(a.get("member_id"))
        a["associate_name"] = associate_names.get(a.get("associate_id"))
        a["payee_name"] = a["member_name"] or a["associate_name"]
    return page_data


# ─── BULK RECEIPT-MEMBER MAPPING ─────────────────────────────────

@router.get("/unassigned-candidates")
def get_unassigned_candidates(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.read")),  # the path decides: Bulk Receipt Mapping read
    search: Optional[str] = None,
    filter_type: Optional[str] = "ALL",  # ALL, MATCHED, UNMATCHED
    limit: int = 500,
) -> Any:
    """Fetch unassigned receipts and cross-reference with members for auto-mapping."""
    q = db.query(Receipt).filter(
        Receipt.is_deleted == False,
        Receipt.receipt_status == "UNASSIGNED",
        Receipt.payment_status != "CANCELLED",
    )

    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            or_(
                Receipt.receipt_number.ilike(s),
                Receipt.payer_name.ilike(s),
                Receipt.payer_membership_no.ilike(s),
                Receipt.payer_mobile.ilike(s),
            )
        )

    receipts = q.order_by(Receipt.id.desc()).limit(limit).all()

    # Pre-fetch candidate members strictly by the permanent membership number (member_code) written on the receipt
    mem_nums = {
        r.payer_membership_no.strip().upper()
        for r in receipts
        if r.payer_membership_no and r.payer_membership_no.strip()
    }

    matched_by_num = {}
    if mem_nums:
        # 1. Match strictly on Member.membership_number (member_code synonym)
        m_rows = (
            db.query(Member)
            .filter(
                Member.is_deleted == False,
                Member.membership_number != None,
                func.upper(func.trim(Member.membership_number)).in_(mem_nums),
            )
            .all()
        )
        for m in m_rows:
            if m.membership_number:
                m_num = m.membership_number.strip().upper()
                matched_by_num[m_num] = m

        # 2. Also check MemberMembership table for permanent membership_number
        mm_rows = (
            db.query(Member, MemberMembership)
            .join(MemberMembership, MemberMembership.member_id == Member.id)
            .filter(
                Member.is_deleted == False,
                MemberMembership.is_deleted == False,
                MemberMembership.membership_number != None,
                func.upper(func.trim(MemberMembership.membership_number)).in_(mem_nums),
            )
            .all()
        )
        for m, mm in mm_rows:
            if mm.membership_number:
                key = mm.membership_number.strip().upper()
                if key not in matched_by_num:
                    matched_by_num[key] = m

    candidates = []
    total_matched = 0

    for r in receipts:
        r_num = (r.payer_membership_no or "").strip().upper()

        matched_m = None
        match_type = "NONE"

        if r_num and r_num in matched_by_num:
            matched_m = matched_by_num[r_num]
            match_type = "EXACT_NUMBER"

        if match_type != "NONE":
            total_matched += 1

        if filter_type == "MATCHED" and match_type == "NONE":
            continue
        if filter_type == "UNMATCHED" and match_type != "NONE":
            continue

        item = {
            "receipt_id": r.id,
            "receipt_number": r.receipt_number,
            "receipt_date": str(r.receipt_date),
            "net_amount": float(r.net_amount),
            "payer_name": r.payer_name,
            "payer_membership_no": r.payer_membership_no,
            "payer_mobile": r.payer_mobile,
            "match_type": match_type,
            "matched_member": None,
        }
        if matched_m:
            full_name = matched_m.display_name
            item["matched_member"] = {
                "id": matched_m.id,
                "name": full_name or matched_m.full_name_kn or f"Member {matched_m.id}",
                "membership_number": matched_m.membership_number or matched_m.member_code,
                "mobile": matched_m.mobile,
                "status": matched_m.approval_status,
            }

        candidates.append(item)

    return {
        "total_unassigned": len(receipts),
        "total_matched": total_matched,
        "candidates": candidates,
    }


import pydantic as _pydantic

class BulkAllocationItem(_pydantic.BaseModel):
    receipt_id: int
    member_id: int
    allocated_amount: Optional[float] = None

class BulkAllocationPayload(_pydantic.BaseModel):
    allocations: list[BulkAllocationItem]

@router.post("/bulk-allocate")
def bulk_allocate_receipts(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.write")),  # the path decides: Bulk Receipt Mapping write
    payload: BulkAllocationPayload,
) -> Any:
    """Map multiple unassigned receipts to members in a single transaction."""
    allocated_count = 0
    failed = []
    affected_member_ids = set()

    for item in payload.allocations:
        receipt = db.query(Receipt).filter(Receipt.id == item.receipt_id, Receipt.is_deleted == False).first()
        if not receipt:
            failed.append({"receipt_id": item.receipt_id, "reason": "Receipt not found"})
            continue
        if receipt_status.is_cancelled(receipt):
            failed.append({"receipt_id": item.receipt_id, "reason": "Cannot allocate cancelled receipt"})
            continue

        member = db.query(Member).filter(Member.id == item.member_id, Member.is_deleted == False).first()
        if not member:
            failed.append({"receipt_id": item.receipt_id, "reason": "Member not found"})
            continue

        alloc_amount = item.allocated_amount if item.allocated_amount is not None else float(receipt.net_amount)

        existing_alloc = db.query(ReceiptAllocation).filter(
            ReceiptAllocation.receipt_id == receipt.id,
            ReceiptAllocation.is_deleted == False,
        ).first()

        if existing_alloc:
            existing_alloc.member_id = member.id
            existing_alloc.allocated_amount = alloc_amount
        else:
            new_alloc = ReceiptAllocation(
                receipt_id=receipt.id,
                member_id=member.id,
                allocated_amount=alloc_amount,
                created_by=current_user.id,
            )
            db.add(new_alloc)

        db.flush()
        receipt_status.refresh(db, receipt)
        allocated_count += 1
        affected_member_ids.add(member.id)

    if affected_member_ids:
        membership_credit.recompute_members(db, list(affected_member_ids), current_user.id)
        from services.magazine_subscriptions import ensure_subscription_on_receipt_assigned
        ensure_subscription_on_receipt_assigned(db, list(affected_member_ids), current_user.id)

    db.commit()
    return {
        "allocated_count": allocated_count,
        "failed_count": len(failed),
        "failed": failed,
    }


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
    if receipt_status.is_cancelled(receipt):
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

    new_items = receipt_in.items if "items" in data else None
    data.pop("items", None)
    if new_items is not None:
        if not new_items:
            raise HTTPException(400, "A receipt needs at least one particular line")
        total = round(sum(float(i.amount) for i in new_items), 2)
        data["gross_amount"] = total
        data["net_amount"] = round(total - float(data.get("discount_amount", receipt.discount_amount)), 2)
        _validate_lines(db, new_items, total)
    if "receipt_number" in data:
        data["receipt_number"] = (data["receipt_number"] or "").strip() or receipt.receipt_number
    new_number = data.get("receipt_number", receipt.receipt_number)
    new_date = data.get("receipt_date") or receipt.receipt_date
    if new_number != receipt.receipt_number or new_date != receipt.receipt_date:
        receipt_numbers.assert_number_free(
            db, receipt_numbers.financial_year_for(new_date), new_number, exclude_id=receipt.id
        )

    net = data.get("net_amount", float(receipt.net_amount))
    allocated = allocated_total(db, receipt.id)
    if net < allocated - 0.01:
        raise HTTPException(
            409,
            f"net_amount {net} is below the already-allocated total {allocated}; "
            f"remove allocations first",
        )
    try:
        updated = crud_receipts.receipt.update(db, db_obj=receipt, obj_in=data, updated_by=current_user.id)
        if new_items is not None:
            for old in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == receipt.id, ReceiptItem.is_deleted == False):  # noqa: E712
                old.is_deleted = True
                old.deleted_by = current_user.id
            for line_no, it in enumerate(new_items, start=1):
                db.add(ReceiptItem(
                    receipt_id=receipt.id, item_type=it.item_type, particular_id=it.particular_id,
                    particular_name=it.particular_name, description=it.description,
                    amount=it.amount, line_no=line_no, created_by=current_user.id,
                ))
            db.commit()
            db.refresh(updated)
        # the member's credit follows the receipt: a single allocation tracks the credit lines (as Receipt Entry
        # sets it), and the upgrade is checked again (it only ever moves up)
        allocs = db.query(ReceiptAllocation).filter(
            ReceiptAllocation.receipt_id == receipt.id, ReceiptAllocation.is_deleted == False  # noqa: E712
        ).all()
        if len(allocs) == 1 and allocs[0].member_id:
            lines = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == receipt.id, ReceiptItem.is_deleted == False).all()  # noqa: E712
            credit = sum(float(i.amount) for i in lines if (i.item_type or "").upper() in ("MEMBERSHIP", "DONATION", "SCHOLARSHIP"))
            allocs[0].allocated_amount = round(min(credit or float(updated.net_amount), float(updated.net_amount)), 2)
            allocs[0].updated_by = current_user.id
        member_ids = [a.member_id for a in allocs if a.member_id]
        if member_ids:
            membership_credit.recompute_members(db, member_ids, current_user.id)
            db.commit()
            membership_credit.flag_for_review(db, member_ids, f"receipt {updated.receipt_number} was edited")
        return updated
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, receipt_numbers.duplicate_message(
            new_number, receipt_numbers.financial_year_for(new_date)))


@router.delete("/{id}", response_model=Union[schemas_receipts.Receipt, PendingApproval])
@approval_gate.gated("receipts", "DELETE", "Receipt", "receipts.delete")
def delete_receipt(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("receipts.delete")),
    id: int,
    force: bool = False,
    dry_run: bool = Query(False, include_in_schema=False),
) -> Any:
    receipt = crud_receipts.receipt.get(db, id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    removed_members = _allocated_member_ids(db, receipt.id)
    if allocated_total(db, receipt.id) > 0:
        if not force:
            raise InUseError(
                "This receipt is mapped to member payments. Deleting it also removes those payment records from the members' history."
            )
        for alloc in db.query(ReceiptAllocation).filter(
            ReceiptAllocation.receipt_id == id, ReceiptAllocation.is_deleted == False  # noqa: E712
        ).all():
            alloc.is_deleted = True
            alloc.deleted_by = current_user.id
        db.flush()
        receipt_status.refresh(db, receipt)
    if dry_run is True:
        return None
    members = removed_members
    removed = crud_receipts.receipt.remove(db, id=id, deleted_by=current_user.id)
    membership_credit.flag_for_review(db, members, f"receipt {receipt.receipt_number} was deleted")
    return removed


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
    if receipt_status.is_cancelled(receipt):
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
    if alloc.member_id:
        from services.magazine_subscriptions import ensure_subscription_on_receipt_assigned
        ensure_subscription_on_receipt_assigned(db, [alloc.member_id], current_user.id)
    receipt_status.refresh(db, receipt)
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
            names[m.id] = m.display_name
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
    db.flush()
    receipt_status.refresh(db, receipt)
    db.commit()
    db.refresh(alloc)
    membership_credit.flag_for_review(db, [alloc.member_id], f"receipt {receipt.receipt_number} was un-assigned")
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
    if receipt_status.is_cancelled(receipt):
        raise HTTPException(400, "Receipt is already cancelled")

    receipt.payment_status = "CANCELLED"
    receipt.receipt_status = "CANCELLED"
    receipt.updated_by = current_user.id
    cancellation = ReceiptCancellation(
        receipt_id=id,
        cancelled_by=current_user.id,
        reason=payload.reason,
        created_by=current_user.id,
    )
    db.add(cancellation)
    db.commit()
    membership_credit.flag_for_review(db, _allocated_member_ids(db, id), f"receipt {receipt.receipt_number} was cancelled")
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
    membership_credit.flag_for_review(db, _allocated_member_ids(db, id), f"receipt {receipt.receipt_number} was refunded")
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
