"""Magazine Subscription automation service.

Ensures synchronization of magazine delivery subscriptions with member profile changes
and receipt allocations:
1. When a member's `magazine_needed` is True and the member is ACTIVE (never an expired or deleted one) and is APPROVED, or is an
   applicant who has PAID (a receipt is assigned to them):
   - Creates or reactivates an ACTIVE MagazineSubscription. An applicant with no receipt yet, and a rejected one, get none.
   - Synchronizes `address_override` with `magazine_delivery_address`.
   - Mirrors into member service opt-ins.
2. When a member's `magazine_needed` is set to False (on edit):
   - Sets any active MagazineSubscription to STOPPED.
   - Cancels the service opt-in.
3. When a receipt is assigned/allocated to a member:
   - If `magazine_needed is True` and no subscription exists yet, creates an ACTIVE subscription.
"""

import logging
from typing import Optional, Iterable
from sqlalchemy.orm import Session
from models.members import Member
from models.magazines import MagazineSubscription
from services.service_types import sync_magazine_optin

logger = logging.getLogger("hms.magazine_subscriptions")


def sync_member_magazine_subscription(
    db: Session,
    member: Member,
    *,
    magazine_needed: Optional[bool] = None,
    delivery_address: Optional[str] = None,
    user_id: Optional[int] = None,
) -> Optional[MagazineSubscription]:
    """Sync a member's MagazineSubscription when magazine_needed or magazine_delivery_address changes."""
    effective_needed = magazine_needed if magazine_needed is not None else member.magazine_needed
    effective_address = delivery_address if delivery_address is not None else member.magazine_delivery_address

    sub = (
        db.query(MagazineSubscription)
        .filter(
            MagazineSubscription.member_id == member.id,
            MagazineSubscription.is_deleted == False,
        )
        .first()
    )

    if effective_needed:
        if member.approval_status == "REJECTED":
            return sub  # a rejected applicant is not on the list
        if member.approval_status != "APPROVED" and not has_paid(db, member.id):
            return sub  # an applicant is on the list from the day a receipt is assigned to them (until then, nothing)
        if member.member_status != "ACTIVE":
            return sub  # an expired or deleted (inactive) member never gets a subscription started, whoever asks
        if not sub:
            sub = MagazineSubscription(
                member_id=member.id,
                delivery_status="ACTIVE",
                address_override=effective_address or None,
                created_by=user_id,
            )
            db.add(sub)
            db.flush()
        else:
            if sub.delivery_status != "ACTIVE":
                sub.delivery_status = "ACTIVE"
            if effective_address is not None:
                sub.address_override = effective_address or None
            sub.updated_by = user_id
            db.add(sub)
            db.flush()

        sync_magazine_optin(db, member_id=member.id, linked_id=sub.id, created_by=user_id)
        return sub
    else:
        # Member does not want magazine
        if sub and sub.delivery_status != "STOPPED":
            sub.delivery_status = "STOPPED"
            sub.updated_by = user_id
            db.add(sub)
            db.flush()
            sync_magazine_optin(db, member_id=member.id, linked_id=None, created_by=user_id)
        return sub


def has_paid(db: Session, member_id: int) -> bool:
    """True when a receipt (not deleted, not cancelled) is assigned to the member."""
    from models.receipts import Receipt, ReceiptAllocation
    return db.query(ReceiptAllocation.id).join(Receipt, Receipt.id == ReceiptAllocation.receipt_id).filter(
        ReceiptAllocation.member_id == member_id, ReceiptAllocation.is_deleted == False,  # noqa: E712
        Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
    ).first() is not None


def ensure_subscription_on_receipt_assigned(
    db: Session,
    member_ids: Iterable[int],
    user_id: Optional[int] = None,
) -> int:
    """When a receipt is allocated to a member whose answer is Yes and who has no subscription,
    create an Active subscription with no end date."""
    valid_ids = {mid for mid in member_ids if mid}
    if not valid_ids:
        return 0

    members = (
        db.query(Member)
        .filter(
            Member.id.in_(valid_ids),
            Member.is_deleted == False,
            Member.magazine_needed == True,  # noqa: E712
            Member.approval_status.in_(("APPROVED", "UNAPPROVED")),   # an applicant gets it when a receipt is assigned (this call is that moment)
            Member.member_status == "ACTIVE",      # an expired or deleted member never gets one, not even by the backfill
        )
        .all()
    )
    if not members:
        return 0

    target_mids = [m.id for m in members]
    existing_subs = {
        s.member_id: s
        for s in db.query(MagazineSubscription)
        .filter(
            MagazineSubscription.member_id.in_(target_mids),
            MagazineSubscription.is_deleted == False,
        )
        .all()
    }

    created_count = 0
    for m in members:
        if m.id not in existing_subs:
            sub = MagazineSubscription(
                member_id=m.id,
                delivery_status="ACTIVE",
                address_override=m.magazine_delivery_address or None,
                created_by=user_id,
            )
            db.add(sub)
            db.flush()
            sync_magazine_optin(db, member_id=m.id, linked_id=sub.id, created_by=user_id)
            existing_subs[m.id] = sub
            created_count += 1

    return created_count
