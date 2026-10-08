"""Shared membership-price lookup."""

from typing import Optional

from sqlalchemy.orm import Session


def active_price(db: Session, membership_type_id: Optional[int]):
    """Current price row for a membership type.

    Prefers the open-ended row (``effective_to IS NULL``), falling back to the
    most recent ``effective_from``. Returns None when no price is configured.
    """
    from models.masters import MembershipTypePrice

    if not membership_type_id:
        return None
    q = db.query(MembershipTypePrice).filter(
        MembershipTypePrice.membership_type_id == membership_type_id,
        MembershipTypePrice.is_deleted == False,
    )
    open_ended = q.filter(MembershipTypePrice.effective_to == None).order_by(
        MembershipTypePrice.effective_from.desc()
    ).first()
    if open_ended:
        return open_ended
    return q.order_by(MembershipTypePrice.effective_from.desc()).first()
