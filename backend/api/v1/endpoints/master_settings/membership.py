
from typing import Any, List, Optional, Union
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from models.masters import MembershipType, MembershipTypePrice
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate

router = APIRouter()

# ─────────────── MEMBERSHIP TYPES ────────────────
def _serialize_type_with_price(db: Session, mt: MembershipType) -> dict:
    from services.pricing import active_price
    price = active_price(db, mt.id)
    return {
        "id": mt.id,
        "code": mt.code,
        "name_en": mt.name_en,
        "name_kn": mt.name_kn,
        "description": mt.description,
        "status": mt.status,
        "chart_color": mt.chart_color,
        "created_at": mt.created_at,
        "current_price": float(price.amount) if price else None,
        "current_price_id": price.id if price else None,
    }


@router.get("/membership-types")
def read_membership_types(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> Any:
    q = db.query(MembershipType).filter(MembershipType.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(MembershipType.name_en.ilike(f"%{search}%"))
    page_data = paginate(q, page, limit)
    price_by_type = {}
    if page_data["data"]:
        type_ids = [item["id"] for item in page_data["data"]]
        from services.pricing import active_price
        prices = {}
        for tid in type_ids:
            p = active_price(db, tid)
            if p:
                prices[tid] = p
        price_by_type = prices
    counts = {}
    if page_data["data"]:
        from sqlalchemy import func
        counts = dict(
            db.query(MembershipTypePrice.membership_type_id, func.count(MembershipTypePrice.id))
            .filter(MembershipTypePrice.membership_type_id.in_([i["id"] for i in page_data["data"]]),
                    MembershipTypePrice.is_deleted == False)  # noqa: E712
            .group_by(MembershipTypePrice.membership_type_id).all()
        )
    for item in page_data["data"]:
        p = price_by_type.get(item["id"])
        item["current_price"] = float(p.amount) if p else None
        item["current_price_id"] = p.id if p else None
        item["price_count"] = int(counts.get(item["id"], 0))  # rows in the price history (1 = base price only)
    return page_data


@router.get("/membership-types/{id}", response_model=schemas_masters.MembershipTypeWithPrice)
def read_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    return _serialize_type_with_price(db, obj)


@router.post("/membership-types", response_model=Union[schemas_masters.MembershipTypeWithPrice, PendingApproval])
@approval_gate.gated("masters", "CREATE", "MembershipTypeWithPrice", "masters.write")
def create_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    mt_in: schemas_masters.MembershipTypeCreate,
) -> Any:
    dup = db.query(MembershipType).filter(
        MembershipType.code == mt_in.code, MembershipType.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Membership type code '{mt_in.code}' already exists")
    obj = crud_masters.membership_type.create(db=db, obj_in=mt_in, created_by=current_user.id)
    return _serialize_type_with_price(db, obj)


@router.put("/membership-types/{id}", response_model=Union[schemas_masters.MembershipTypeWithPrice, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "MembershipTypeWithPrice", "masters.write")
def update_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    mt_in: schemas_masters.MembershipTypeUpdate,
) -> Any:
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    data = mt_in.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != obj.code:
        dup = db.query(MembershipType).filter(
            MembershipType.code == data["code"],
            MembershipType.is_deleted == False,  # noqa: E712
            MembershipType.id != id,
        ).first()
        if dup:
            raise HTTPException(409, f"Membership type code '{data['code']}' already exists")
    crud_masters.membership_type.update(db, db_obj=obj, obj_in=mt_in, updated_by=current_user.id)
    return _serialize_type_with_price(db, obj)


@router.delete("/membership-types/{id}", response_model=Union[schemas_masters.MembershipTypeWithPrice, PendingApproval])
@approval_gate.gated("masters", "DELETE", "MembershipTypeWithPrice", "masters.delete")
def delete_membership_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    from models.members import MemberMembership
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    in_use = db.query(MemberMembership).filter(
        MemberMembership.membership_type_id == id,
        MemberMembership.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(409, "Membership type is assigned to members and cannot be deleted")
    crud_masters.membership_type.remove(db, id=id, deleted_by=current_user.id)
    return _serialize_type_with_price(db, obj)


# ─────────────── MEMBERSHIP TYPE PRICES ────────────────
@router.get("/membership-types/{id}/prices", response_model=Any)
def read_membership_type_prices(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """Full price history for a membership type, newest first."""
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    q = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).order_by(MembershipTypePrice.effective_from.desc(), MembershipTypePrice.id.desc())
    return paginate(q, page, limit)


@router.post("/membership-types/{id}/prices", response_model=Union[schemas_masters.MembershipTypePrice, PendingApproval])
@approval_gate.gated("masters", "CREATE", "MembershipTypePrice", "masters.write")
def create_membership_type_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    price_in: schemas_masters.MembershipTypePriceCreate,
) -> Any:
    """Set a new price — closes the current open-ended price row and opens a new one.

    This preserves full price history: old rows keep their effective_from/to span,
    the new row is open-ended until the next change.
    """
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")

    effective_from = price_in.effective_from or date.today()
    if price_in.amount < 0:
        raise HTTPException(422, "Amount must be non-negative")

    def _reprice_in_place(row: MembershipTypePrice) -> MembershipTypePrice:
        """Same-day correction: reprice an existing row instead of stacking a duplicate."""
        was = float(row.amount)
        row.amount = price_in.amount
        row.currency = price_in.currency
        # keep a trail of what it was, since the row is corrected instead of stacked
        note = (price_in.change_reason or "Price revision").strip()
        row.change_reason = f"{note} (was {was:,.2f})"[:500]
        row.updated_by = current_user.id
        db.commit()
        db.refresh(row)
        return row

    # Exact-start match: a row already begins on this date → correct it in place.
    same_start = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_from == effective_from,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if same_start:
        return _reprice_in_place(same_start)

    # Date falls inside a closed row's span → that row is the active price on
    # that day (happens when a future-dated row already superseded it).
    span_row = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_from <= effective_from,
        MembershipTypePrice.effective_to >= effective_from,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if span_row:
        return _reprice_in_place(span_row)

    # Genuine new version: close the currently open-ended row(s) the day before.
    open_rows = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.effective_to == None,  # noqa: E711
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).all()
    for row in open_rows:
        if row.effective_from > effective_from:
            raise HTTPException(
                400,
                f"Existing price (id={row.id}) starts on {row.effective_from}; "
                "new price must take effect on or after that date",
            )
        row.effective_to = effective_from - timedelta(days=1)

    new_price = MembershipTypePrice(
        membership_type_id=id,
        amount=price_in.amount,
        currency=price_in.currency,
        effective_from=effective_from,
        effective_to=None,
        change_reason=price_in.change_reason,
        created_by=current_user.id,
    )
    db.add(new_price)
    db.commit()
    db.refresh(new_price)
    return new_price


@router.post("/membership-types/{id}/prices/old", response_model=Union[schemas_masters.MembershipTypePrice, PendingApproval])
@approval_gate.gated("masters", "CREATE", "MembershipTypePrice", "masters.write")
def create_old_membership_type_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    price_in: schemas_masters.MembershipTypeOldPriceCreate,
) -> Any:
    """Add the price a type had in earlier financial years (From FY to FY, an amount): the history that old members'
    receipts are checked against. The row runs from 1 April of the first year to 31 March after the last one and
    must not overlap a price the type already has."""
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    this_year = date.today().year
    if not (1900 <= price_in.from_year <= price_in.to_year <= this_year):
        raise HTTPException(422, f"Give the financial years as start years from 1900 to {this_year}, the first not after the last")
    if price_in.amount <= 0:
        raise HTTPException(422, "Amount must be more than zero")
    start = date(price_in.from_year, 4, 1)
    end = date(price_in.to_year + 1, 3, 31)

    for row in db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == id, MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).all():
        if row.effective_from <= end and (row.effective_to is None or row.effective_to >= start):
            span = f"{row.effective_from} to {row.effective_to}" if row.effective_to else f"from {row.effective_from}"
            raise HTTPException(409, f"These years overlap an existing price of {float(row.amount):g} ({span}). Edit that price instead, or choose other years.")

    fy = lambda y: f"{y}-{str(y + 1)[-2:]}"  # noqa: E731
    new_price = MembershipTypePrice(
        membership_type_id=id, amount=price_in.amount, currency=price_in.currency,
        effective_from=start, effective_to=end,
        change_reason=(price_in.change_reason or f"Old price, FY {fy(price_in.from_year)} to {fy(price_in.to_year)}").strip(),
        created_by=current_user.id,
    )
    db.add(new_price)
    db.commit()
    db.refresh(new_price)
    return new_price


@router.get("/membership-types/{id}/prices/current", response_model=schemas_masters.MembershipTypePrice)
def read_membership_type_current_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """The price currently in effect (open-ended row, or most recent)."""
    obj = crud_masters.membership_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Membership type not found")
    from services.pricing import active_price
    price = active_price(db, id)
    if not price:
        raise HTTPException(404, "No price configured for this membership type")
    return price


@router.put("/membership-types/{id}/prices/{price_id}", response_model=Union[schemas_masters.MembershipTypePrice, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "MembershipTypePrice", "masters.write")
def update_membership_type_price(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    price_id: int,
    price_in: schemas_masters.MembershipTypePriceUpdate,
) -> Any:
    """Correct a price row (e.g. typo in amount or extend effective_to)."""
    price = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.id == price_id,
        MembershipTypePrice.membership_type_id == id,
        MembershipTypePrice.is_deleted == False,  # noqa: E712
    ).first()
    if not price:
        raise HTTPException(404, "Price row not found for this membership type")
    data = price_in.model_dump(exclude_unset=True)
    if "amount" in data and data["amount"] is not None and data["amount"] < 0:
        raise HTTPException(422, "Amount must be non-negative")
    return crud_masters.membership_type_price.update(
        db, db_obj=price, obj_in=price_in, updated_by=current_user.id
    )



# ─────────────── MEMBERSHIP CREDIT SETTING ───────────────
@router.get("/membership-credit-settings")
def read_membership_credit_settings(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)) -> Any:
    """Checkbox model for the "what counts toward the membership total"
    screen: every receipt type with a label and whether it is ticked
    (`selected`) and ticked by default (`default`). Only ticked types add to
    a member's credit and so toward auto-upgrade."""
    from services import membership_credit
    return {
        "receipt_types": membership_credit.credit_receipt_types(db),
        "default": membership_credit.DEFAULT_RECEIPT_TYPES,
        "options": membership_credit.receipt_type_options(db),
    }


@router.put("/membership-credit-settings")
@approval_gate.gated("masters", "UPDATE", "MembershipCreditSettings", "masters.write", id_param=None)
def update_membership_credit_settings(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    receipt_types: List[str],
) -> Any:
    """Save the ticked receipt types (send the full list of codes that
    should count). Takes effect for the next payment or recalculation."""
    from services import membership_credit
    try:
        cleaned = membership_credit.parse_types(receipt_types)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not cleaned:
        raise HTTPException(400, "Select at least one receipt type")
    saved = membership_credit.set_credit_receipt_types(db, cleaned, current_user.id)
    db.commit()
    return {
        "receipt_types": saved,
        "options": membership_credit.receipt_type_options(db, saved),
    }


@router.post("/membership-credit-settings/reset")
@approval_gate.gated("masters", "UPDATE", "MembershipCreditSettingsReset", "masters.write", id_param=None)
def reset_membership_credit_settings(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
) -> Any:
    """Back to the default ticks."""
    from services import membership_credit
    saved = membership_credit.set_credit_receipt_types(db, membership_credit.DEFAULT_RECEIPT_TYPES, current_user.id)
    db.commit()
    return {"receipt_types": saved, "options": membership_credit.receipt_type_options(db, saved)}
