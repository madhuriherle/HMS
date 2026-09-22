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
    current_user: User = Depends(deps.get_current_user),
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

    return {
        "members": {
            "total": total_members,
            "approved": approved_members,
            "unapproved": unapproved_members,
            "inactive": inactive_members,
        },
        "receipts": {
            "total_count": total_receipts,
            "total_amount": float(total_receipt_amount),
        },
        "magazines": {
            "active_subscriptions": active_subscriptions,
            "paused_subscriptions": paused_subscriptions,
            "returns_this_month": returns_this_month,
        },
        "pending_approvals": {
            "profile_changes": pending_profile_changes,
            "type_changes": pending_type_changes,
            "deletion_requests": pending_deletions,
            "total": pending_profile_changes + pending_type_changes + pending_deletions,
        }
    }
