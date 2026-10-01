"""Membership credit: payments add up, and the total buys a membership type.

A member's *credit* is the sum of the money allocated to them on receipts
(successful, not cancelled, net of refunds) of the receipt types that count
toward membership (setting ``membership_credit.receipt_types``; default
MEMBERSHIP, TYPE_CHANGE and general donations).

The membership *ladder* is the active membership types ordered by their
current price. The member qualifies for the most expensive type whose price
is <= their credit:

    credit 1500, ladder Poshaka 1000 / Mahaposhaka 5000
      -> qualifies for Poshaka, remaining 500 (kept toward the next type)
    +4500 more later -> credit 6000 -> Mahaposhaka, remaining 1000

Auto-upgrade only ever moves a member UP (never downgrades on a refund or
cancellation — that stays a manual, reviewed change) and never replaces a type
that has no price (honorary / special types are left alone). The "remaining" is not
stored anywhere; it is always credit minus the price of the qualified type,
so it can never drift from the receipts.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

SETTING_KEY = "membership_credit.receipt_types"
DEFAULT_RECEIPT_TYPES = ["MEMBERSHIP", "TYPE_CHANGE", "GENERAL_DONATION", "DONATION"]
# Receipt payment statuses that count as money received.
COUNTED_STATUSES = ("SUCCESS", "PAID")
# Refund statuses that mean the money did not go back.
IGNORED_REFUND_STATUSES = ("FAILED", "REJECTED", "CANCELLED", "PENDING")


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def credit_receipt_types(db: Session) -> list:
    from models.masters import HmsSetting
    row = db.query(HmsSetting).filter(
        HmsSetting.setting_key == SETTING_KEY, HmsSetting.is_deleted == False  # noqa: E712
    ).first()
    value = row.setting_value if row else None
    if isinstance(value, dict):
        value = value.get("receipt_types")
    if isinstance(value, list) and value:
        return [str(v).upper() for v in value]
    return list(DEFAULT_RECEIPT_TYPES)


def set_credit_receipt_types(db: Session, types: list, user_id: Optional[int]) -> list:
    from models.masters import HmsSetting
    cleaned = sorted({t.strip().upper() for t in types if t and t.strip()})
    row = db.query(HmsSetting).filter(HmsSetting.setting_key == SETTING_KEY).first()
    if row:
        row.setting_value = {"receipt_types": cleaned}
        row.is_deleted = False
        row.updated_by = user_id
    else:
        db.add(HmsSetting(
            setting_key=SETTING_KEY, setting_value={"receipt_types": cleaned}, data_type="json",
            description="Receipt types whose allocated amounts count toward a member's membership credit",
            created_by=user_id,
        ))
    db.flush()
    return cleaned


def ladder(db: Session) -> list:
    """[(MembershipType, price Decimal)] for active types with a price > 0,
    cheapest first."""
    from models.masters import MembershipType
    from services.pricing import active_price

    tiers = []
    for mt in db.query(MembershipType).filter(
        MembershipType.is_deleted == False, MembershipType.status == True  # noqa: E712
    ).all():
        price = active_price(db, mt.id)
        if price and _d(price.amount) > 0:
            tiers.append((mt, _d(price.amount)))
    tiers.sort(key=lambda t: (t[1], t[0].id))
    return tiers


def credit_ledger(db: Session, member_id: int) -> dict:
    """Counted allocations for the member, with refund-adjusted amounts."""
    from models.receipts import Receipt, ReceiptAllocation, RefundTransaction

    types = credit_receipt_types(db)
    rows = (
        db.query(ReceiptAllocation, Receipt)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(
            ReceiptAllocation.member_id == member_id,
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            Receipt.is_deleted == False,  # noqa: E712
            Receipt.payment_status.in_(COUNTED_STATUSES),
            Receipt.receipt_type.in_(types),
        )
        .order_by(Receipt.receipt_date, ReceiptAllocation.id)
        .all()
    )
    refunded = {}
    receipt_ids = {r.id for _, r in rows}
    if receipt_ids:
        for rf in db.query(RefundTransaction).filter(
            RefundTransaction.receipt_id.in_(receipt_ids), RefundTransaction.is_deleted == False  # noqa: E712
        ).all():
            if (rf.status or "").upper() not in IGNORED_REFUND_STATUSES:
                refunded[rf.receipt_id] = refunded.get(rf.receipt_id, Decimal(0)) + _d(rf.amount)

    entries, total = [], Decimal(0)
    for alloc, receipt in rows:
        gross = _d(alloc.allocated_amount)
        net_amount = _d(receipt.net_amount)
        fraction = min(Decimal(1), refunded.get(receipt.id, Decimal(0)) / net_amount) if net_amount > 0 else Decimal(0)
        counted = (gross * (Decimal(1) - fraction)).quantize(Decimal("0.01"))
        total += counted
        entries.append({
            "allocation_id": alloc.id, "receipt_id": receipt.id,
            "receipt_number": receipt.receipt_number, "receipt_date": receipt.receipt_date,
            "receipt_type": receipt.receipt_type, "allocated_amount": float(gross),
            "counted_amount": float(counted),
        })
    return {"total": total, "entries": entries, "receipt_types": types}


def _current_membership(db: Session, member_id: int):
    from models.members import MemberMembership
    return (
        db.query(MemberMembership)
        .filter(
            MemberMembership.member_id == member_id,
            MemberMembership.status == "ACTIVE",
            MemberMembership.is_deleted == False,  # noqa: E712
        )
        .order_by(MemberMembership.id.desc())
        .first()
    )


def summary(db: Session, member_id: int) -> dict:
    """Credit, current / qualified type, remaining and the gap to the next type."""
    from models.masters import MembershipType
    from services.pricing import active_price

    led = credit_ledger(db, member_id)
    total = led["total"]
    tiers = ladder(db)
    qualified = None
    for mt, price in tiers:
        if price <= total:
            qualified = (mt, price)
    nxt = next(((mt, price) for mt, price in tiers if price > total), None)
    remaining = total - (qualified[1] if qualified else Decimal(0))

    current = _current_membership(db, member_id)
    current_type = db.get(MembershipType, current.membership_type_id) if current else None
    current_price = active_price(db, current.membership_type_id) if current else None

    def _t(pair):
        return {"id": pair[0].id, "code": pair[0].code, "name_en": pair[0].name_en, "price": float(pair[1])} if pair else None

    return {
        "member_id": member_id,
        "credit_total": float(total),
        "counted_receipt_types": led["receipt_types"],
        "current_type": (
            {"id": current_type.id, "code": current_type.code, "name_en": current_type.name_en,
             "price": float(_d(current_price.amount)) if current_price else None}
            if current_type else None
        ),
        "qualified_type": _t(qualified),
        "remaining_amount": float(remaining),
        "next_type": _t(nxt),
        "amount_to_next_type": float(nxt[1] - total) if nxt else None,
        "upgrade_pending": bool(qualified and (
            not current or (current_price is not None and qualified[1] > _d(current_price.amount))
        )),
        "ledger": led["entries"],
    }


def apply_auto_upgrade(db: Session, member_id: int, acted_by: Optional[int]) -> Optional[dict]:
    """Move the member up to the type their credit has reached. Returns a
    description of the change, or None when nothing changed. Does not commit."""
    from models.members import Member, MemberMembership, MembershipTypeHistory
    from services.pricing import active_price
    from services.sequences import generate_next_number

    member = db.query(Member).filter(Member.id == member_id, Member.is_deleted == False).first()  # noqa: E712
    if not member:
        return None
    total = credit_ledger(db, member_id)["total"]
    qualified = None
    for mt, price in ladder(db):
        if price <= total:
            qualified = (mt, price)
    if not qualified:
        return None
    target, target_price = qualified
    price_row = active_price(db, target.id)
    now = datetime.now(timezone.utc)
    reason = f"Auto-upgrade: payments total {total} reached {target.name_en} ({target_price})"

    current = _current_membership(db, member_id)
    if current is None:
        membership = MemberMembership(
            member_id=member_id, membership_type_id=target.id,
            price_id=price_row.id if price_row else None,
            applied_at=now, status="ACTIVE", created_by=acted_by,
        )
        if member.approval_status == "APPROVED":
            membership.membership_number = generate_next_number(db, "MEMBERSHIP_NO", "HMSM")
            membership.activated_at = now
        db.add(membership)
        db.flush()
        db.add(MembershipTypeHistory(
            member_id=member_id, membership_id=membership.id, old_type_id=None,
            new_type_id=target.id, old_price=None, new_price=float(target_price),
            changed_by=acted_by, changed_at=now, reason=reason, created_by=acted_by,
        ))
        return {"action": "CREATED", "type": target.code, "price": float(target_price), "credit_total": float(total)}

    if current.membership_type_id == target.id:
        return None
    old_price_row = active_price(db, current.membership_type_id)
    if old_price_row is None:
        return None  # an unpriced (honorary / special) type is never replaced automatically
    old_price = _d(old_price_row.amount)
    if target_price <= old_price:
        return None  # never auto-downgrade
    old_type_id = current.membership_type_id
    current.membership_type_id = target.id
    current.price_id = price_row.id if price_row else current.price_id
    current.updated_by = acted_by
    db.add(MembershipTypeHistory(
        member_id=member_id, membership_id=current.id, old_type_id=old_type_id,
        new_type_id=target.id, old_price=float(old_price) if old_price_row else None,
        new_price=float(target_price), changed_by=acted_by, changed_at=now,
        reason=reason, created_by=acted_by,
    ))
    return {"action": "UPGRADED", "type": target.code, "price": float(target_price), "credit_total": float(total)}


def recompute_members(db: Session, member_ids, acted_by: Optional[int]) -> list:
    """Run the auto-upgrade for each member id; returns the changes made."""
    changes = []
    for mid in {m for m in member_ids if m}:
        change = apply_auto_upgrade(db, mid, acted_by)
        if change:
            changes.append({"member_id": mid, **change})
    return changes
