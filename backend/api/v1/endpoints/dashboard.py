from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.members import Member, MemberMembership
from models.receipts import Receipt
from models.magazines import MagazineSubscription, MagazineReturn
from datetime import date

router = APIRouter()

@router.get("/")
def get_dashboard(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("dashboard.read")),
) -> Any:
    """Returns summary stats for the dashboard."""

    total_members = db.query(Member).filter(Member.is_deleted == False).count()
    approved_members = db.query(Member).filter(Member.approval_status == "APPROVED", Member.is_deleted == False).count()
    unapproved_members = db.query(Member).filter(Member.approval_status == "UNAPPROVED", Member.is_deleted == False).count()
    inactive_members = db.query(Member).filter(Member.member_status == "INACTIVE", Member.is_deleted == False).count()

    total_receipts = db.query(Receipt).filter(Receipt.is_deleted == False).count()
    from sqlalchemy import func
    total_receipt_amount = db.query(func.sum(Receipt.net_amount)).filter(Receipt.is_deleted == False).scalar() or 0

    active_subscriptions = db.query(MagazineSubscription).filter(MagazineSubscription.delivery_status == "ACTIVE", MagazineSubscription.is_deleted == False).count()
    paused_subscriptions = db.query(MagazineSubscription).filter(MagazineSubscription.delivery_status == "PAUSED", MagazineSubscription.is_deleted == False).count()
    returns_this_month = db.query(MagazineReturn).filter(
        MagazineReturn.return_date >= date.today().replace(day=1)
    ).count()

    # Pending approvals
    from models.members import MemberProfileChangeRequest, MembershipTypeChangeRequest, MemberDeletionRequest
    pending_profile_changes = db.query(MemberProfileChangeRequest).filter(MemberProfileChangeRequest.status == "PENDING").count()
    pending_type_changes = db.query(MembershipTypeChangeRequest).filter(MembershipTypeChangeRequest.status == "PENDING").count()
    pending_deletions = db.query(MemberDeletionRequest).filter(MemberDeletionRequest.status == "PENDING").count()

    # Every block of numbers is shown only to someone who may read that data;
    # a block the user may not see comes back as null.
    held = deps.user_permission_codes(db, current_user)
    all_access = deps.is_all_access(db, current_user)

    def allowed(*codes: str) -> bool:
        return all_access or any(c in held for c in codes)

    from models.users import Module

    def module_on(code: str) -> bool:
        row = db.query(Module).filter(Module.code == code, Module.is_deleted == False).first()  # noqa: E712
        return bool(row and row.status)

    # Collection: today / this month / last month, receipts waiting to be mapped, memberships due to renew.
    from datetime import timedelta
    from models.receipts import ReceiptAllocation

    live_receipts = [Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED"]  # noqa: E712
    today = date.today()
    first_this = today.replace(day=1)
    first_last = (first_this - timedelta(days=1)).replace(day=1)

    def collected(start, end=None):
        q = db.query(func.coalesce(func.sum(Receipt.net_amount), 0)).filter(*live_receipts, Receipt.receipt_date >= start)
        if end:
            q = q.filter(Receipt.receipt_date < end)
        return float(q.scalar() or 0)

    unassigned = db.query(Receipt).filter(*live_receipts, Receipt.receipt_status == "UNASSIGNED").count()

    from models.masters import MembershipType
    by_type = [
        {"membership_type": mt.name_en, "member_count": count, "color": mt.chart_color}
        for mt, count in (
            db.query(MembershipType, func.count(MemberMembership.id))
            .join(MemberMembership, MemberMembership.membership_type_id == MembershipType.id)
            .filter(MembershipType.is_deleted == False, MemberMembership.is_deleted == False)  # noqa: E712
            .group_by(MembershipType.id)
            .all()
        )
    ]

    return {
        "members": {
            "total": total_members,
            "approved": approved_members,
            "unapproved": unapproved_members,
            "inactive": inactive_members,
        } if allowed("members.read", "members.list.read", "members.unapproved.read") else None,
        # members per membership type (the dashboard chart); needs no Reports access
        "memberships_by_type": by_type if allowed("members.read", "members.list.read", "members.unapproved.read") else None,
        "receipts": {
            "total_count": total_receipts,
            "total_amount": float(total_receipt_amount),
            "today_amount": collected(today, today + timedelta(days=1)),
            "month_amount": collected(first_this),
            "last_month_amount": collected(first_last, first_this),
            "unassigned_count": unassigned,
        } if allowed("receipts.read", "receipts.entry.read", "receipts.tracking.read") else None,
        "magazines": {
            "active_subscriptions": active_subscriptions,
            "paused_subscriptions": paused_subscriptions,
            "returns_this_month": returns_this_month,
        } if allowed("magazines.read") and module_on("magazines") else None,
        "pending_approvals": {
            "profile_changes": pending_profile_changes,
            "type_changes": pending_type_changes,
            "deletion_requests": pending_deletions,
            "total": pending_profile_changes + pending_type_changes + pending_deletions,
        } if allowed("approvals.read") else None,
    }


@router.get("/search")
def global_search(
    q: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """One search box: members (name, code, membership no., mobile) and receipts (number, payer, reference)."""
    from sqlalchemy import func, or_
    from models.members import MemberMembership

    text = (q or "").strip()
    if len(text) < 2:
        return {"members": [], "receipts": []}
    held = deps.user_permission_codes(db, current_user)
    all_access = deps.is_all_access(db, current_user)
    can = lambda *codes: all_access or any(c in held for c in codes)  # noqa: E731
    like = f"%{text}%"
    members, receipts = [], []
    if can("members.read", "members.list.read", "members.unapproved.read"):
        by_number = db.query(MemberMembership.member_id).filter(
            MemberMembership.is_deleted == False, func.upper(MemberMembership.membership_number) == text.upper()  # noqa: E712
        )
        rows = (
            db.query(Member)
            .filter(
                Member.is_deleted == False,  # noqa: E712
                or_(
                    Member.first_name_en.ilike(like), Member.last_name_en.ilike(like), Member.full_name_kn.ilike(like),
                    Member.member_code.ilike(like), Member.mobile.like(f"%{''.join(ch for ch in text if ch.isdigit()) or '#'}%"),
                    Member.id.in_(by_number),
                ),
            )
            .order_by(Member.first_name_en)
            .limit(6)
            .all()
        )
        members = [
            {"id": m.id, "name": " ".join(x for x in (m.first_name_en, m.last_name_en) if x),
             "member_code": m.member_code, "mobile": m.mobile, "approval_status": m.approval_status}
            for m in rows
        ]
    if can("receipts.read", "receipts.tracking.read", "receipts.entry.read"):
        rows = (
            db.query(Receipt)
            .filter(
                Receipt.is_deleted == False,  # noqa: E712
                or_(Receipt.receipt_number.ilike(like), Receipt.payer_name.ilike(like), Receipt.transaction_reference.ilike(like)),
            )
            .order_by(Receipt.id.desc())
            .limit(6)
            .all()
        )
        receipts = [
            {"id": r.id, "receipt_number": r.receipt_number, "payer_name": r.payer_name,
             "amount": float(r.net_amount), "receipt_date": r.receipt_date}
            for r in rows
        ]
    return {"members": members, "receipts": receipts}
