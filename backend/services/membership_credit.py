"""Membership credit: payments add up, and the total buys a membership type.

A member's *credit* is the sum of the money allocated to them on receipts
(successful, not cancelled, net of refunds) of the receipt types that count
toward membership (setting ``membership_credit.receipt_types``; default
MEMBERSHIP and TYPE_CHANGE only: a donation never changes the membership type).

The membership *ladder* is the active membership types ordered by their
current price. The member qualifies for the most expensive type whose price
is <= their credit:

    credit 1500, ladder Poshaka 1000 / Mahaposhaka 5000
      -> qualifies for Poshaka, remaining 500 (kept toward the next type)
    +4500 more later -> credit 6000 -> Mahaposhaka, remaining 1000

Auto-tier moves a member UP when payments reach a higher tier, and
DOWN when payments are removed, deleted, or cancelled (never replaces a type
that has no price: honorary / special types are left alone). The "remaining" is not
stored anywhere; it is always credit minus the price of the qualified type,
so it can never drift from the receipts.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

SETTING_KEY = "membership_credit.receipt_types"
# Only money paid for the membership counts: the membership fee and the upgrade difference.
# Donations, P.Nidhi, scholarship, magazine and event receipts never change the membership type.
# (An admin can still add types under the membership credit setting.)
DEFAULT_RECEIPT_TYPES = ["MEMBERSHIP", "TYPE_CHANGE"]
# Receipt payment statuses that count as money received.
COUNTED_STATUSES = ("SUCCESS", "PAID")
# Refund statuses that mean the money did not go back.
IGNORED_REFUND_STATUSES = ("FAILED", "REJECTED", "CANCELLED", "PENDING")


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


RECEIPT_TYPE_LABELS = {
    "MEMBERSHIP": "Membership fee / renewal",
    "TYPE_CHANGE": "Membership upgrade difference",
    "GENERAL_DONATION": "General donation",
    "DONATION": "Donation (legacy)",
    "DONATION_1": "Donation 1",
    "DONATION_2": "Donation 2",
    "DONATION_3": "Donation 3",
    "P_NIDHI": "P. Nidhi",
    "SCHOLARSHIP": "Scholarship",
    "MAGAZINE": "Magazine",
    "EVENT": "Event",
    "OTHER": "Other",
}


def all_receipt_types() -> list:
    """Every receipt type that can be ticked: the types a receipt can carry
    plus TYPE_CHANGE (minted by the upgrade-approval flow)."""
    from api.v1.endpoints.receipts import VALID_RECEIPT_TYPES
    codes = set(VALID_RECEIPT_TYPES) | {"TYPE_CHANGE"}
    order = list(RECEIPT_TYPE_LABELS)
    return sorted(codes, key=lambda c: (order.index(c) if c in order else len(order), c))


def receipt_type_options(db: Session, selected: Optional[list] = None) -> list:
    """Checkbox model for the frontend: one entry per receipt type, ticked
    when it currently counts toward the membership total."""
    chosen = set(selected if selected is not None else credit_receipt_types(db))
    return [
        {
            "code": c,
            "label": RECEIPT_TYPE_LABELS.get(c, c.replace("_", " ").title()),
            "selected": c in chosen,
            "default": c in DEFAULT_RECEIPT_TYPES,
        }
        for c in all_receipt_types()
    ]


def parse_types(raw) -> list:
    """Normalise + validate a list / comma string of receipt types."""
    items = raw.split(",") if isinstance(raw, str) else list(raw or [])
    cleaned = []
    for t in items:
        t = (t or "").strip().upper()
        if t and t not in cleaned:
            cleaned.append(t)
    known = all_receipt_types()
    unknown = [t for t in cleaned if t not in known]
    if unknown:
        raise ValueError("Unknown receipt type(s): " + ", ".join(sorted(unknown)))
    return cleaned


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


def _counted_rows(db: Session, member_ids: list, types: list) -> list:
    """[(allocation, receipt, counted gross Decimal, refund-adjusted counted Decimal)] for the members.

    What counts is the money on the receipt's *lines* of a counted type (a membership line yes, a donation line
    no), capped by what was allocated to the member. So a receipt with Membership 500 + Donation 4500 counts 500,
    and the order of the lines does not matter. A receipt whose lines carry no known type (old single-line
    receipts) counts by its receipt type instead."""
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem, RefundTransaction

    rows = (
        db.query(ReceiptAllocation, Receipt)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(
            ReceiptAllocation.member_id.in_(member_ids),
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            Receipt.is_deleted == False,  # noqa: E712
            Receipt.payment_status.in_(COUNTED_STATUSES),
        )
        .order_by(Receipt.receipt_date, ReceiptAllocation.id)
        .all()
    )
    receipt_ids = {r.id for _, r in rows}
    wanted = {t.upper() for t in types}
    line_total, has_typed_lines = {}, set()
    refunded = {}
    if receipt_ids:
        for it in db.query(ReceiptItem).filter(
            ReceiptItem.receipt_id.in_(receipt_ids), ReceiptItem.is_deleted == False  # noqa: E712
        ).all():
            # a line with a particular on record counts when that main particular is ticked "pays for membership"
            # (copied onto the line when the receipt was saved); a line with no particular (an old receipt) counts by
            # its line type against the saved list of counted receipt types
            has_typed_lines.add(it.receipt_id)
            counted = it.pays_for_membership if it.particular_id is not None else (it.item_type or "").upper() in wanted
            if counted:
                line_total[it.receipt_id] = line_total.get(it.receipt_id, Decimal(0)) + _d(it.amount)
        for rf in db.query(RefundTransaction).filter(
            RefundTransaction.receipt_id.in_(receipt_ids), RefundTransaction.is_deleted == False  # noqa: E712
        ).all():
            if (rf.status or "").upper() not in IGNORED_REFUND_STATUSES:
                refunded[rf.receipt_id] = refunded.get(rf.receipt_id, Decimal(0)) + _d(rf.amount)

    room = {}   # counted money of a receipt not yet handed to an allocation (a receipt may be shared)
    out = []
    for alloc, receipt in rows:
        if receipt.id in has_typed_lines:
            room.setdefault(receipt.id, line_total.get(receipt.id, Decimal(0)))
        elif (receipt.receipt_type or "").upper() in wanted:
            room.setdefault(receipt.id, _d(receipt.net_amount))
        else:
            continue
        gross = min(_d(alloc.allocated_amount), room[receipt.id])
        if gross <= 0:
            continue
        room[receipt.id] -= gross
        net_amount = _d(receipt.net_amount)
        fraction = min(Decimal(1), refunded.get(receipt.id, Decimal(0)) / net_amount) if net_amount > 0 else Decimal(0)
        out.append((alloc, receipt, gross, (gross * (Decimal(1) - fraction)).quantize(Decimal("0.01"))))
    return out


def credit_ledger(db: Session, member_id: int, types: Optional[list] = None) -> dict:
    """Counted allocations for the member, with refund-adjusted amounts.
    `types` overrides the saved setting (used for previews)."""
    types = types if types is not None else credit_receipt_types(db)
    entries, total = [], Decimal(0)
    for alloc, receipt, gross, counted in _counted_rows(db, [member_id], types):
        total += counted
        entries.append({
            "allocation_id": alloc.id, "receipt_id": receipt.id,
            "receipt_number": receipt.receipt_number, "receipt_date": receipt.receipt_date,
            "receipt_type": receipt.receipt_type, "allocated_amount": float(gross),
            "counted_amount": float(counted),
        })
    return {"total": total, "entries": entries, "receipt_types": types}


def credit_totals(db: Session, member_ids: list, types: Optional[list] = None) -> dict:
    """{member_id: credit total} for many members (same rules as credit_ledger)."""
    if not member_ids:
        return {}
    types = types if types is not None else credit_receipt_types(db)
    totals = {}
    for alloc, _receipt, _gross, counted in _counted_rows(db, list(member_ids), types):
        totals[alloc.member_id] = totals.get(alloc.member_id, Decimal(0)) + counted
    return {mid: float(v) for mid, v in totals.items()}


def flag_for_review(db: Session, member_ids, reason: str) -> int:
    """After money was taken away (a cancelled / deleted / refunded receipt, a removed allocation) the member may
    hold a type their credit no longer pays for. The type is never lowered automatically (rule 8.2), so tell the
    approvers to review it. Returns how many members were flagged."""
    from services.approval_notify import notify_approvers
    from services.pricing import active_price
    from models.members import Member

    flagged = 0
    for mid in {m for m in member_ids if m}:
        current = _current_membership(db, mid)
        price = active_price(db, current.membership_type_id) if current else None
        if not price or _d(price.amount) <= 0:
            continue
        total = credit_ledger(db, mid)["total"]
        if total + Decimal("0.005") >= _d(price.amount):
            continue
        member = db.get(Member, mid)
        who = " ".join(x for x in (member.name_title, member.display_name) if x) if member else f"Member {mid}"
        flagged += 1 if notify_approvers(
            db, "Membership type needs review",
            f"{who}: credit is now {total} but their type costs {_d(price.amount)} ({reason}). Review it.",
            {"member_id": mid, "kind": "MEMBERSHIP_CREDIT_REVIEW"},
        ) else 0
    return flagged


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


def summary(db: Session, member_id: int, receipt_types: Optional[list] = None) -> dict:
    """Credit, current / qualified type, remaining and the gap to the next type."""
    from models.masters import MembershipType
    from services.pricing import active_price

    led = credit_ledger(db, member_id, receipt_types)
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

    # What the member is working toward: the type they hold when they have not yet paid its price,
    # otherwise the next type up the ladder.
    held_price = _d(current_price.amount) if current_price else None
    if current_type and held_price and held_price > total:
        target = (current_type, held_price)
    else:
        target = nxt

    def _t(pair):
        return {"id": pair[0].id, "code": pair[0].code, "name_en": pair[0].name_en, "price": float(pair[1])} if pair else None

    return {
        "member_id": member_id,
        "credit_total": float(total),
        "preview": receipt_types is not None,
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
        "target_type": _t(target),
        "amount_to_target": float(target[1] - total) if target else None,
        "upgrade_pending": bool(qualified and (
            not current or (current_price is not None and qualified[1] > _d(current_price.amount))
        )),
        "ledger": led["entries"],
    }


def apply_auto_upgrade(db: Session, member_id: int, acted_by: Optional[int]) -> Optional[dict]:
    """Recompute the member's tier according to their actual credit.
    Upgrades when payments reach a higher tier.
    Downgrades when payments are removed, deleted, or cancelled.
    Returns a description of the change, or None when nothing changed. Does not commit."""
    from models.members import Member, MemberMembership, MembershipTypeHistory
    from models.masters import MembershipType
    from services.pricing import active_price
    from services.sequences import generate_next_number

    member = db.query(Member).filter(Member.id == member_id, Member.is_deleted == False).first()  # noqa: E712
    if not member:
        return None
    # a payment that does not add up to the price of the joining era (an old receipt is probably missing): no change
    # of type until it is entered
    check = payment_check_rows(db, [member_id]).get(member_id)
    if check and check["mismatch"]:
        return None
    total = credit_ledger(db, member_id)["total"]
    tiers = ladder(db)
    if not tiers:
        return None

    qualified = None
    for mt, price in tiers:
        if price <= total:
            qualified = (mt, price)

    now = datetime.now(timezone.utc)
    current = _current_membership(db, member_id)

    if current is None:
        if not qualified:
            return None
        target, target_price = qualified
        price_row = active_price(db, target.id)
        reason = f"Auto-upgrade: payments total {total} reached {target.name_en} ({target_price})"
        membership = MemberMembership(
            member_id=member_id, membership_type_id=target.id,
            price_id=price_row.id if price_row else None,
            applied_at=now, status="ACTIVE", created_by=acted_by,
        )
        if member.approval_status == "APPROVED":
            from services.member_activation import membership_number_for
            membership.membership_number = membership_number_for(db, member)
            membership.activated_at = now
        db.add(membership)
        db.flush()
        db.add(MembershipTypeHistory(
            member_id=member_id, membership_id=membership.id, old_type_id=None,
            new_type_id=target.id, old_price=None, new_price=float(target_price),
            changed_by=acted_by, changed_at=now, reason=reason, created_by=acted_by,
        ))
        return {"action": "CREATED", "type": target.code, "price": float(target_price), "credit_total": float(total)}

    old_price_row = active_price(db, current.membership_type_id)
    if old_price_row is None:
        return None  # an unpriced (honorary / special) type is never replaced automatically
    old_price = _d(old_price_row.amount)

    if qualified is not None:
        target, target_price = qualified
        if current.membership_type_id == target.id or target_price <= old_price:
            return None   # the type never moves down here: that happens when money is removed (after_money_removed)
        price_row = active_price(db, target.id)
        old_type_id = current.membership_type_id
        current.membership_type_id = target.id
        current.price_id = price_row.id if price_row else current.price_id
        current.updated_by = acted_by
        reason = f"Auto-upgrade: payments total {total} reached {target.name_en} ({target_price})"
        db.add(MembershipTypeHistory(
            member_id=member_id, membership_id=current.id, old_type_id=old_type_id,
            new_type_id=target.id, old_price=float(old_price),
            new_price=float(target_price), changed_by=acted_by, changed_at=now,
            reason=reason, created_by=acted_by,
        ))
        return {"action": "UPGRADED", "type": target.code, "price": float(target_price), "credit_total": float(total)}

    return None


def frozen_members(db: Session, member_ids) -> set:
    """Members whose payment does not add up to the price of their joining era (an old receipt is probably missing).
    Called BEFORE money is removed: such a member is left alone, because their shortfall is not caused by the removal."""
    ids = [m for m in set(member_ids or []) if m]
    if not ids:
        return set()
    return {m for m, info in payment_check_rows(db, ids).items() if info["mismatch"]}


def lower_if_unpaid(db: Session, member_id: int, acted_by: Optional[int]) -> Optional[dict]:
    """After money was removed (a receipt deleted, cancelled, refunded or un-assigned): if the member's payments no
    longer pay for the type they hold, move them down to the highest type their payments do pay for. Both are judged at
    the prices of the day of their latest receipt (a receipt dated 1980 is judged by the 1980 prices), so an old member
    who paid the price of their time is not judged by today's price. With no receipt left there is nothing to judge by.
    Returns the change, or None."""
    from models.masters import MembershipType, MembershipTypePrice
    from models.members import MembershipTypeHistory

    current = _current_membership(db, member_id)
    if current is None:
        return None
    ledger = credit_ledger(db, member_id)
    dates = [e["receipt_date"] for e in ledger["entries"] if e["receipt_date"]]
    if not dates:
        return None
    since = max(dates)
    prices = db.query(MembershipTypePrice).filter(MembershipTypePrice.is_deleted == False).all()  # noqa: E712
    held = _price_on(prices, current.membership_type_id, since)
    if held is None or _d(held.amount) <= 0:
        return None
    required = _d(held.amount)
    total = ledger["total"]
    if total + Decimal("0.005") >= required:
        return None

    best = None
    for mt in db.query(MembershipType).filter(MembershipType.is_deleted == False, MembershipType.status == True).all():  # noqa: E712
        row = _price_on(prices, mt.id, since)
        if row is None:
            continue
        amount = _d(row.amount)
        if 0 < amount <= total and amount < required and (best is None or amount > best[2]):
            best = (mt, row, amount)
    if best is None:
        return None   # nothing cheaper is paid for either: left to the approvers (they get the review notice)

    target, row, amount = best
    old_type = db.get(MembershipType, current.membership_type_id)
    old_type_id = current.membership_type_id
    current.membership_type_id = target.id
    current.price_id = row.id
    current.updated_by = acted_by
    db.add(MembershipTypeHistory(
        member_id=member_id, membership_id=current.id, old_type_id=old_type_id, new_type_id=target.id,
        old_price=float(required), new_price=float(amount), changed_by=acted_by, changed_at=datetime.now(timezone.utc),
        reason=f"Auto-downgrade: payments total {total} no longer pay for {old_type.name_en if old_type else 'the type'} ({required}); now {target.name_en} ({amount})",
        created_by=acted_by,
    ))
    return {"action": "DOWNGRADED", "type": target.code, "price": float(amount), "credit_total": float(total)}


def after_money_removed(db: Session, member_ids, acted_by: Optional[int], frozen=()) -> list:
    """Run lower_if_unpaid for each member (except those frozen before the removal). Does not commit."""
    changes = []
    for mid in {m for m in (member_ids or []) if m}:
        if mid in frozen:
            continue
        change = lower_if_unpaid(db, mid, acted_by)
        if change:
            changes.append({"member_id": mid, **change})
    return changes


def recompute_members(db: Session, member_ids, acted_by: Optional[int]) -> list:
    """Run the auto-upgrade for each member id; returns the changes made."""
    changes = []
    for mid in {m for m in member_ids if m}:
        change = apply_auto_upgrade(db, mid, acted_by)
        if change:
            changes.append({"member_id": mid, **change})
    return changes


# ── payment check against the price of the day of the member's latest receipt ──────────────

def _price_on(prices: list, type_id, on):
    """The price row of a type that was in force on a date, or None when no row covers it."""
    for row in prices:
        if row.membership_type_id != type_id:
            continue
        if row.effective_from <= on and (row.effective_to is None or row.effective_to >= on):
            return row
    return None


def payment_check_rows(db: Session, member_ids=None) -> dict:
    """{member_id: info} for approved members: do their payments cover the price of the type they hold?

    The price is the one in force on the date of the member's latest membership receipt (Membership Types > price
    history), so a member whose last receipt is dated 1980 is judged by the 1980 price, not today's. Every receipt
    counts the same, real or dummy, as long as it is mapped to the member and is of a type that counts toward
    membership. A member with no such receipt at all has `no_receipt` set and is flagged. A member whose receipt date
    falls under no price row of their type cannot be judged and is left out. `mismatch` is true when the payments
    fall short: an old receipt is probably missing, so no type change is made for them until it is entered."""
    from models.masters import MembershipTypePrice
    from models.members import Member, MemberMembership

    q = (
        db.query(MemberMembership)
        .join(Member, Member.id == MemberMembership.member_id)
        .filter(
            MemberMembership.is_deleted == False,  # noqa: E712
            MemberMembership.status == "ACTIVE",
            Member.is_deleted == False,  # noqa: E712
            Member.approval_status == "APPROVED",
        )
        .order_by(MemberMembership.member_id, MemberMembership.id)
    )
    if member_ids is not None:
        q = q.filter(MemberMembership.member_id.in_(list(member_ids)))
    held = {}
    for ms in q.all():
        held[ms.member_id] = ms   # the latest active membership is the one they hold
    if not held:
        return {}

    prices = db.query(MembershipTypePrice).filter(MembershipTypePrice.is_deleted == False).all()  # noqa: E712
    if not prices:
        return {}
    types = credit_receipt_types(db)
    paid = {}
    ids = list(held)
    for i in range(0, len(ids), 500):
        for alloc, receipt, _gross, counted in _counted_rows(db, ids[i:i + 500], types):
            paid.setdefault(alloc.member_id, []).append((receipt.receipt_date, counted))

    today = datetime.now(timezone.utc).date()
    out = {}
    for mid, ms in held.items():
        rows = paid.get(mid, [])
        reference = max((d for d, _c in rows), default=None)
        row = _price_on(prices, ms.membership_type_id, reference or today)
        if row is None or _d(row.amount) <= 0:
            continue
        expected = _d(row.amount)
        credit = sum((c for _d_, c in rows), Decimal(0))
        out[mid] = {
            "member_id": mid, "type_id": ms.membership_type_id, "reference_date": reference,
            "no_receipt": not rows, "price_then": float(expected), "paid": float(credit),
            "shortfall": float(max(Decimal(0), expected - credit)),
            "mismatch": credit + Decimal("0.005") < expected,
        }
    return out
