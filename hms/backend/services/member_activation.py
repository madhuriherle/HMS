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

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.members import Member, MemberApprovalHistory, MemberMembership
from services.sequences import generate_next_number


def activate_member(db: Session, member: Member, *, activated_by: int) -> Member:
    """Apply the activation mutations. Does NOT commit — the caller owns the
    transaction (and, for the WhatsApp activation message, the background
    task queue)."""
    now = datetime.now(timezone.utc)
    old_status = member.approval_status

    # Auto-generate member_code
    if not member.member_code:
        member.member_code = generate_next_number(db, "MEMBER_CODE", "HMS")
    member.approval_status = "APPROVED"
    member.approved_by = activated_by
    member.approved_at = now
    db.add(MemberApprovalHistory(
        member_id=member.id,
        action="APPROVE",
        old_status=old_status,
        new_status="APPROVED",
        acted_by=activated_by,
        acted_at=now,
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
        membership.membership_number = generate_next_number(db, "MEMBERSHIP_NO", "HMSM")
        membership.activated_at = now
        membership.updated_by = activated_by

    return member
