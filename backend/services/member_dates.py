"""The dates a member is known by, worked out from what is stored (nothing is saved).

The system dates of an imported member (created, approved, and the membership start when the register had none) are all the day of the
import, which says nothing about the member. So:

* imported member: Registered on / Member since = the date of the first receipt (not cancelled); with no receipt, the register's own
  enrolled date when it is a real one; otherwise nothing. Never an approval date: the import approved everyone on one day.
* imported applicant (not approved yet): the date they applied (the register's enrolled date), else their first receipt; no member since.
* any other member: Registered on = the day the form was registered, Approved on = the day it was approved, Member since = the day it was approved.
* the day of an import is kept apart (``imported_on``) for the one line at the bottom of a profile.
"""
from datetime import date, datetime
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.members import Member, MemberMembership
from models.receipts import Receipt, ReceiptAllocation

IMPORT_SOURCES = ("MIGRATION", "IMPORT")
FIRST_YEAR = 1943          # the Sabha began in 1943: an earlier date is a typing mistake


def _day(value) -> Optional[date]:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def is_imported(member: Member) -> bool:
    return member.registration_source in IMPORT_SOURCES or bool(getattr(member, "is_imported", False))


def first_receipt_dates(db: Session, member_ids: Iterable[int]) -> dict:
    """member id -> the date of the earliest receipt that is not cancelled."""
    ids = [i for i in set(member_ids) if i]
    if not ids:
        return {}
    rows = (
        db.query(ReceiptAllocation.member_id, func.min(Receipt.receipt_date))
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .filter(ReceiptAllocation.member_id.in_(ids), ReceiptAllocation.is_deleted == False,  # noqa: E712
                Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED")  # noqa: E712
        .group_by(ReceiptAllocation.member_id).all()
    )
    return {mid: d for mid, d in rows if d}


def enrolled_dates(db: Session, members: list) -> dict:
    """member id -> the register's enrolled date, when it is a real one (an imported membership with no enrolled date was stamped with
    the day of the import, which is not a real date)."""
    ids = [m.id for m in members if is_imported(m)]
    if not ids:
        return {}
    created = {m.id: _day(m.created_at) for m in members}
    out = {}
    for mid, applied in (
        db.query(MemberMembership.member_id, MemberMembership.applied_at)
        .filter(MemberMembership.member_id.in_(ids), MemberMembership.is_deleted == False)  # noqa: E712
        .order_by(MemberMembership.id.asc()).all()
    ):
        d = _day(applied)
        if d and d.year >= FIRST_YEAR and d != created.get(mid) and d <= date.today():
            out.setdefault(mid, d)          # the earliest membership record
    return out


def dates_for(db: Session, members: list) -> dict:
    """member id -> {registered_on, approved_on, member_since, imported_on} (dates, or None)."""
    first = first_receipt_dates(db, [m.id for m in members if is_imported(m)])
    enrolled = enrolled_dates(db, members)
    out = {}
    for m in members:
        approved = str(m.approval_status).upper() == "APPROVED"
        if is_imported(m):
            if approved:
                registered = first.get(m.id) or enrolled.get(m.id)
            else:
                registered = enrolled.get(m.id) or first.get(m.id)
            out[m.id] = {"registered_on": registered, "approved_on": None, "member_since": registered if approved else None,
                         "imported_on": _day(m.created_at)}
        else:
            approved_on = _day(m.approved_at) if approved else None
            out[m.id] = {"registered_on": _day(m.created_at), "approved_on": approved_on, "member_since": approved_on, "imported_on": None}
    return out


def dates_for_one(db: Session, member: Member) -> dict:
    return dates_for(db, [member])[member.id]


def attach_dates(db: Session, rows: list) -> None:
    """Each listed member (a dict with an id) carries registered_on, approved_on and member_since."""
    ids = [r["id"] for r in rows if isinstance(r, dict) and r.get("id")]
    if not ids:
        return
    members = db.query(Member).filter(Member.id.in_(ids)).all()
    dates = dates_for(db, members)
    for r in rows:
        if isinstance(r, dict) and r.get("id") in dates:
            d = dates[r["id"]]
            r["registered_on"], r["approved_on"], r["member_since"] = d["registered_on"], d["approved_on"], d["member_since"]
