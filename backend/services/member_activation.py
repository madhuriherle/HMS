"""Shared member-activation core.

Activation = approval + permanent identity: the member_code is minted,
approval_status flips to APPROVED with the approver/at recorded, an approval
history row is written, and every membership row still missing its permanent
number gets one (sequence-generated) plus activated_at (spec: "activation
assigns the membership number").

Two entry points share this so they can never drift:
  * PUT /members/{id}/approve           — staff approval from the worklist
  * POST /receipts/{id}/activate-member — activate straight from a receipt's
    tracking row (the offline workflow records the money first, then the
    unapproved profile behind the receipt is activated from Receipt Tracking)

Idempotency is the caller's job: both endpoints refuse already-APPROVED
members with a 409 rather than double-numbering.
"""

from datetime import date, datetime, timezone
from typing import Optional, Union

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.members import Member, MemberApprovalHistory, MemberMembership
from services.sequences import generate_next_number


# What a member must have on file before becoming a permanent member.
REQUIRED_FOR_APPROVAL = (
    ("first_name_en", "name"),
    ("mobile", "mobile"),
    ("date_of_birth", "date of birth"),
    ("address_line1", "address"),
)


def membership_number_for(db: Session, member: Member, exclude_id=None):
    """After approval a member has ONE permanent number (their member_code, set in Number Formats as the
    membership number). Their membership record shows that same number, so nothing else is minted. A second
    membership of the same member gets none, because the number belongs to the member."""
    code = member.member_code
    if not code:
        return None
    taken = db.query(MemberMembership.id).filter(
        MemberMembership.member_id == member.id,
        MemberMembership.is_deleted == False,  # noqa: E712
        MemberMembership.membership_number == code,
        MemberMembership.id != (exclude_id or 0),
    ).first()
    return None if taken else code


def approval_gaps(member: Member) -> list:
    """The details still missing before this member can be approved (empty = ready)."""
    return [label for attr, label in REQUIRED_FOR_APPROVAL if not str(getattr(member, attr, None) or "").strip()]


def activate_member(db: Session, member: Member, *, activated_by: int, reason: Optional[str] = None, approved_date: Optional[Union[date, datetime]] = None) -> Member:
    """Apply the activation mutations. Does NOT commit — the caller owns the
    transaction (and, for the WhatsApp activation message, the background
    task queue)."""
    if member.approval_status == "REJECTED":
        raise HTTPException(409, f"{member.display_name or 'This applicant'} was rejected in the meeting: re-open the application first")
    gaps = approval_gaps(member)
    if gaps:
        name = member.display_name or f"Member {member.id}"
        raise HTTPException(400, f"Cannot approve {name}: missing {', '.join(gaps)}")
    now = datetime.now(timezone.utc)
    if approved_date:
        if isinstance(approved_date, datetime):
            approval_dt = approved_date if approved_date.tzinfo else approved_date.replace(tzinfo=timezone.utc)
        elif isinstance(approved_date, date):
            approval_dt = datetime.combine(approved_date, now.time()).replace(tzinfo=timezone.utc)
        else:
            approval_dt = now
    else:
        approval_dt = now
    old_status = member.approval_status

    # Auto-generate member_code
    if not member.member_code:
        # skip a number already typed in by hand for an existing member
        for _ in range(100):
            code = generate_next_number(db, "MEMBER_CODE", "HMS")
            if not db.query(Member.id).filter(Member.membership_number == code, Member.is_deleted == False).first():  # noqa: E712
                break
        member.member_code = code
    member.approval_status = "APPROVED"
    member.approved_by = activated_by
    member.approved_at = approval_dt
    db.add(MemberApprovalHistory(
        member_id=member.id,
        action="APPROVE",
        old_status=old_status,
        new_status="APPROVED",
        reason=reason or "Approved",
        acted_by=activated_by,
        acted_at=approval_dt,
        created_by=activated_by,
    ))

    # Spec: activation assigns the permanent membership number to the member's
    # membership rows (numbers are minted by the sequence generator).
    memberships = (
        db.query(MemberMembership)
        .filter(
            MemberMembership.member_id == member.id,
            MemberMembership.is_deleted == False,  # noqa: E712
            MemberMembership.membership_number == None,  # noqa: E711
        )
        .all()
    )
    for membership in memberships:
        membership.membership_number = membership_number_for(db, member, exclude_id=membership.id)
        db.flush()  # a second membership of this member must see the number as taken
        membership.activated_at = approval_dt
        membership.updated_by = activated_by

    # receipts mapped to this member refresh their status (ASSIGNED or CANCELLED)
    from services import receipt_status
    db.flush()
    receipt_status.refresh_for_members(db, [member.id])

    # a member who said Yes to the magazine is on the subscription from final approval
    if member.magazine_needed:
        from services.magazine_subscriptions import sync_member_magazine_subscription
        sync_member_magazine_subscription(db, member, user_id=activated_by)

    return member
