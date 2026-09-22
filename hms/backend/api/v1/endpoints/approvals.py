from typing import Any, Optional
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from models.users import User
from models.members import (
    MemberProfileChangeRequest, MemberProfileHistory,
    MembershipTypeChangeRequest, MembershipTypeHistory, MemberDeletionRequest,
    Member, MemberMembership, MemberApprovalHistory,
    MemberDocument, MemberKycRequest, MemberProfileHistory as _MPH,
)
from models.activity import MemberActivityLog
from models.engagements import CommitteeMemberLink
from models.events import EventMemberLink, EventParticipant
from models.magazines import MagazineDeliveryPause, MagazineReturn, MagazineSubscription
from models.notifications import NotificationMessage, NotificationRecipient
from models.receipts import Receipt, ReceiptItem, ReceiptAllocation
from schemas.members import EDITABLE_MEMBER_FIELDS
from services.pricing import active_price
from services.sequences import generate_next_number

router = APIRouter()


# ─── shared helpers ─────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _purge_member(db: Session, member_id: int) -> None:
    """Hard-delete a member and everything that references them.

    Children are removed in FK dependency order inside one transaction.
    Rows that carry financial/campaign history but allow NULLs (receipt
    allocations, notification recipients, event participants) are detached
    instead of deleted so the audit trail survives.
    """
    def _delete(model):
        db.query(model).filter(model.member_id == member_id).delete(
            synchronize_session=False
        )

    def _detach(model):
        db.query(model).filter(model.member_id == member_id).update(
            {"member_id": None}, synchronize_session=False
        )

    # 1. Rows whose only purpose is this member's history
    _delete(MemberActivityLog)
    _delete(MemberKycRequest)
    _delete(MemberProfileHistory)
    _delete(MemberProfileChangeRequest)
    _delete(MemberApprovalHistory)
    _delete(MembershipTypeHistory)
    _delete(MembershipTypeChangeRequest)
    _delete(MemberDocument)

    # 2. Magazine subscriptions (pauses/returns first)
    subscription_ids = [
        row[0]
        for row in db.query(MagazineSubscription.id)
        .filter(MagazineSubscription.member_id == member_id)
        .all()
    ]
    if subscription_ids:
        db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.subscription_id.in_(subscription_ids)
        ).delete(synchronize_session=False)
        db.query(MagazineReturn).filter(
            MagazineReturn.subscription_id.in_(subscription_ids)
        ).delete(synchronize_session=False)
    _delete(MagazineSubscription)

    # 3. Allocations keep the money trail — just detach the member
    db.query(ReceiptAllocation).filter(
        ReceiptAllocation.member_id == member_id
    ).update({"member_id": None, "membership_id": None}, synchronize_session=False)

    # 4. Memberships (after allocations no longer point at them)
    _delete(MemberMembership)

    # 5. Nullable references elsewhere
    _detach(NotificationRecipient)
    _detach(NotificationMessage)
    _detach(EventParticipant)
    db.query(EventMemberLink).filter(
        EventMemberLink.member_id == member_id
    ).delete(synchronize_session=False)
    db.query(CommitteeMemberLink).filter(
        CommitteeMemberLink.hms_member_id == member_id
    ).delete(synchronize_session=False)

    # 6. Deletion requests (including the one being approved — FK is NOT NULL)
    _delete(MemberDeletionRequest)

    # 7. Login accounts linked to the member
    db.query(User).filter(User.member_id == member_id).update(
        {"member_id": None}, synchronize_session=False
    )

    member = db.get(Member, member_id)
    if member is not None:
        db.delete(member)


# ─── PROFILE CHANGE REQUESTS ────────────────────────────────
@router.get("/profile-changes")
def read_profile_changes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    status: Optional[str] = None,
    page: int = 1, limit: int = 20,
) -> Any:
    q = db.query(MemberProfileChangeRequest)
    if status: q = q.filter(MemberProfileChangeRequest.status == status)
    return paginate(q.order_by(MemberProfileChangeRequest.id.desc()), page, limit)

@router.put("/profile-changes/{id}/approve")
def approve_profile_change(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: Optional[str] = None
) -> Any:
    req = db.query(MemberProfileChangeRequest).filter(MemberProfileChangeRequest.id == id).first()
    if not req: raise HTTPException(404, "Request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")

    # Apply changes to the member — ONLY whitelisted fields, no matter what
    # the request contains (defence in depth; schema validates on submit too).
    member = db.query(Member).filter(Member.id == req.member_id).first()
    skipped = []
    if member and req.new_values:
        import json
        changes = req.new_values if isinstance(req.new_values, dict) else json.loads(req.new_values)
        now = _now()
        for field, new_val in changes.items():
            if field not in EDITABLE_MEMBER_FIELDS:
                skipped.append(field)
                continue
            if hasattr(member, field):
                old_val = getattr(member, field, None)
                history = MemberProfileHistory(
                    member_id=member.id,
                    field_name=field,
                    old_value=str(old_val) if old_val is not None else None,
                    new_value=str(new_val),
                    change_request_id=req.id,
                    changed_by=current_user.id,
                    changed_at=now,
                )
                db.add(history)
                setattr(member, field, new_val)
        member.updated_by = current_user.id

    req.status = "APPROVED"
    req.reviewed_by = current_user.id
    req.reviewed_at = _now()
    req.review_note = note
    db.commit()
    if skipped:
        return {
            "message": "Profile change approved; non-editable fields were skipped",
            "skipped_fields": skipped,
        }
    return {"message": "Profile change approved and applied"}

@router.put("/profile-changes/{id}/reject")
def reject_profile_change(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: str
) -> Any:
    req = db.query(MemberProfileChangeRequest).filter(MemberProfileChangeRequest.id == id).first()
    if not req: raise HTTPException(404, "Request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")
    req.status = "REJECTED"
    req.reviewed_by = current_user.id
    req.reviewed_at = _now()
    req.review_note = note
    db.commit()
    return {"message": "Profile change rejected"}

# ─── MEMBERSHIP TYPE CHANGE REQUESTS ────────────────────────
@router.get("/type-changes")
def read_type_changes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    status: Optional[str] = None,
    page: int = 1, limit: int = 20,
) -> Any:
    q = db.query(MembershipTypeChangeRequest)
    if status: q = q.filter(MembershipTypeChangeRequest.status == status)
    return paginate(q.order_by(MembershipTypeChangeRequest.id.desc()), page, limit)

@router.put("/type-changes/{id}/approve")
def approve_type_change(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: Optional[str] = None
) -> Any:
    """Approve a type change: update the membership, record history, and mint
    a receipt for the upgrade difference (spec: 'new receipt for the same').
    The receipt is PENDING until finance receives the money.
    """
    from models.masters import MembershipType

    req = db.query(MembershipTypeChangeRequest).filter(MembershipTypeChangeRequest.id == id).first()
    if not req: raise HTTPException(404, "Request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")

    membership = db.query(MemberMembership).filter(MemberMembership.id == req.current_membership_id).first()
    receipt_id = None

    if membership:
        old_type_id = membership.membership_type_id
        old_price = active_price(db, old_type_id)
        new_price = active_price(db, req.requested_type_id)

        membership.membership_type_id = req.requested_type_id
        if new_price:
            membership.price_id = new_price.id
        membership.updated_by = current_user.id

        # Receipt for the price difference (downgrades record no receipt)
        old_amount = float(old_price.amount) if old_price else 0.0
        new_amount = float(new_price.amount) if new_price else 0.0
        difference = round(new_amount - old_amount, 2)
        if difference > 0 and new_price:
            old_type = db.get(MembershipType, old_type_id)
            new_type = db.get(MembershipType, req.requested_type_id)
            member = db.get(Member, membership.member_id)
            payer = " ".join(
                p for p in (
                    getattr(member, "first_name_en", None),
                    getattr(member, "last_name_en", None),
                ) if p
            ) or None
            description = (
                f"Membership upgrade {old_type.code if old_type else old_type_id}"
                f" -> {new_type.code if new_type else req.requested_type_id}"
            )
            receipt = Receipt(
                receipt_number=generate_next_number(db, "RECEIPT", "REC"),
                receipt_date=date.today(),
                receipt_type="TYPE_CHANGE",
                payer_name=payer,
                payment_mode="PENDING",
                gross_amount=difference,
                discount_amount=0,
                net_amount=difference,
                payment_status="PENDING",
                source="OFFLINE",
                notes=description,
                created_by=current_user.id,
            )
            db.add(receipt)
            db.flush()
            db.add(ReceiptItem(
                receipt_id=receipt.id,
                item_type="TYPE_CHANGE",
                description=description,
                amount=difference,
                created_by=current_user.id,
            ))
            receipt_id = receipt.id

        db.add(MembershipTypeHistory(
            member_id=membership.member_id,
            membership_id=membership.id,
            old_type_id=old_type_id,
            new_type_id=req.requested_type_id,
            old_price=old_amount if old_price else None,
            new_price=new_amount if new_price else None,
            receipt_id=receipt_id,
            changed_by=current_user.id,
            changed_at=_now(),
            reason=req.reason,
        ))

    req.status = "APPROVED"
    req.reviewed_by = current_user.id
    req.reviewed_at = _now()
    req.review_note = note
    db.commit()
    return {
        "message": "Membership type change approved",
        "receipt_id": receipt_id,
    }

@router.put("/type-changes/{id}/reject")
def reject_type_change(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: str
) -> Any:
    req = db.query(MembershipTypeChangeRequest).filter(MembershipTypeChangeRequest.id == id).first()
    if not req: raise HTTPException(404, "Request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")
    req.status = "REJECTED"
    req.reviewed_by = current_user.id
    req.reviewed_at = _now()
    req.review_note = note
    db.commit()
    return {"message": "Membership type change rejected"}

# ─── DELETION REQUESTS ──────────────────────────────────────
@router.get("/deletion-requests")
def read_deletion_requests(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    status: Optional[str] = None,
    page: int = 1, limit: int = 20,
) -> Any:
    q = db.query(MemberDeletionRequest)
    if status: q = q.filter(MemberDeletionRequest.status == status)
    return paginate(q.order_by(MemberDeletionRequest.id.desc()), page, limit)

@router.post("/deletion-requests")
def request_deletion(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: int, reason: str,
    deletion_type: str = "SOFT"  # SOFT or PERMANENT
) -> Any:
    member = db.query(Member).filter(Member.id == member_id, Member.is_deleted == False).first()
    if not member:
        raise HTTPException(404, "Member not found")
    if deletion_type not in ("SOFT", "PERMANENT"):
        raise HTTPException(400, "deletion_type must be SOFT or PERMANENT")
    req = MemberDeletionRequest(
        member_id=member_id, requested_by=current_user.id,
        reason=reason, deletion_type=deletion_type,
        status="PENDING", created_by=current_user.id
    )
    db.add(req)
    db.commit()
    return {"message": "Deletion request submitted"}

@router.put("/deletion-requests/{id}/approve")
def approve_deletion(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: Optional[str] = None
) -> Any:
    req = db.query(MemberDeletionRequest).filter(MemberDeletionRequest.id == id).first()
    if not req: raise HTTPException(404, "Deletion request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")

    now = _now()

    if req.deletion_type == "PERMANENT":
        # Cascades through every referencing table (and removes this request
        # row too, since its FK is NOT NULL), so return immediately after.
        _purge_member(db, req.member_id)
        db.commit()
        return {"message": "Member permanently deleted"}

    member = db.query(Member).filter(Member.id == req.member_id).first()
    if member:
        member.is_deleted = True
        member.deleted_by = current_user.id
        member.deleted_at = now
        member.updated_by = current_user.id

        db.add(MemberApprovalHistory(
            member_id=req.member_id,
            action="DELETE",
            old_status=member.member_status,
            new_status="DELETED",
            reason=req.reason,
            acted_by=current_user.id,
            acted_at=now,
            created_by=current_user.id,
        ))

    req.status = "APPROVED"
    req.reviewed_by = current_user.id
    req.reviewed_at = now
    req.review_note = note
    req.executed_at = now
    db.commit()
    return {"message": "Member soft-deleted"}

@router.put("/deletion-requests/{id}/reject")
def reject_deletion(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("approvals.write")),
    id: int, note: str
) -> Any:
    req = db.query(MemberDeletionRequest).filter(MemberDeletionRequest.id == id).first()
    if not req: raise HTTPException(404, "Deletion request not found")
    if req.status != "PENDING": raise HTTPException(400, f"Request is already {req.status}")
    req.status = "REJECTED"
    req.reviewed_by = current_user.id
    req.reviewed_at = _now()
    req.review_note = note
    db.commit()
    return {"message": "Deletion request rejected"}
