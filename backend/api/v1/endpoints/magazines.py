from typing import Any, Optional, List, Union
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.members import Member, MemberKycRequest
from models.magazines import (
    MagazineDeliveryBatch,
    MagazineDeliveryPause,
    MagazineLabelBatch,
    MagazineLabelBatchItem,
    MagazineReturn,
    MagazineSubscription,
)
from schemas import magazines as schemas_magazines
from schemas.common import PendingApproval
from crud import magazines as crud_magazines
from core.config import settings
from core.pagination import paginate, LIST_PAGE_MAX
from services.whatsapp import whatsapp_service
from services import approval_gate
from datetime import datetime, date, timezone
import hashlib
import secrets

router = APIRouter()


def _page_limit(limit: int) -> int:
    """A list a person pages through never returns more than 200 rows per request (rule 10.6)."""
    return max(1, min(int(limit), LIST_PAGE_MAX))

VALID_DELIVERY_STATUSES = {"ACTIVE", "STOPPED"}  # Cancelled was merged into Stopped (migration 0091)
VALID_FOLLOW_UP_STATUSES = {"PENDING", "CONTACTED", "RESOLVED"}


def _get_member_subscription(db: Session, member_id: int) -> MagazineSubscription:
    """A member has at most one magazine subscription."""
    return (
        db.query(MagazineSubscription)
        .filter(
            MagazineSubscription.member_id == member_id,
            MagazineSubscription.is_deleted == False,
        )
        .first()
    )


# ─────────────── SUBSCRIPTIONS (start/stop delivery) ───────────────
@router.get("/subscriptions")
def read_subscriptions(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    member_id: Optional[int] = None,
    delivery_status: Optional[str] = None,
    sort_by: Optional[str] = None,   # id | created_at | delivery_status
    sort_dir: str = "desc",
) -> Any:
    from core.sorting import sort_query
    q = db.query(MagazineSubscription).filter(MagazineSubscription.is_deleted == False)
    if member_id: q = q.filter(MagazineSubscription.member_id == member_id)
    if delivery_status: q = q.filter(MagazineSubscription.delivery_status == delivery_status)
    q = sort_query(q, sort_by=sort_by, sort_dir=sort_dir, tiebreak=MagazineSubscription.id,
                   allowed={"id": MagazineSubscription.id, "created_at": MagazineSubscription.created_at,
                            "delivery_status": MagazineSubscription.delivery_status},
                   newest_first=(MagazineSubscription.id.desc(),))
    return paginate(q, page, _page_limit(limit))


@router.get("/subscriptions/{sub_id}", response_model=schemas_magazines.MagazineSubscription)
def read_subscription(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), sub_id: int
) -> Any:
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return sub


def _refuse_if_cannot_receive(member: Member) -> None:
    """An expired or deleted (inactive) member, and a rejected applicant, never get the magazine: no one can start it for them."""
    if member.member_status != "ACTIVE":
        raise HTTPException(400, "An expired or deleted member does not get the magazine")
    if member.approval_status == "REJECTED":
        raise HTTPException(400, "A rejected applicant does not get the magazine")


@router.post("/subscriptions", response_model=Union[schemas_magazines.MagazineSubscription, PendingApproval], status_code=201)
@approval_gate.gated("magazines", "CREATE", "MagazineSubscription", "magazines.write")
def create_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    sub_in: schemas_magazines.MagazineSubscriptionCreate
) -> Any:
    """Start magazine delivery for a member (after registration)."""
    member = db.query(Member).filter(Member.id == sub_in.member_id, Member.is_deleted == False).first()
    if not member:
        raise HTTPException(400, f"Member {sub_in.member_id} not found")
    if sub_in.delivery_status not in VALID_DELIVERY_STATUSES:
        raise HTTPException(400, f"delivery_status must be one of {sorted(VALID_DELIVERY_STATUSES)}")
    _refuse_if_cannot_receive(member)
    existing = _get_member_subscription(db, sub_in.member_id)
    if existing:
        raise HTTPException(409, f"Member already has a subscription (id={existing.id}, status={existing.delivery_status})")
    sub = crud_magazines.subscription.create(db=db, obj_in=sub_in, created_by=current_user.id)
    # Mirror into the member's generic service opt-in list so "Magazine" shows
    # on the profile without a second manual opt-in.
    from services.service_types import sync_magazine_optin
    sync_magazine_optin(db, member_id=sub_in.member_id, linked_id=sub.id, created_by=current_user.id)
    db.commit()
    return sub


@router.put("/subscriptions/{sub_id}", response_model=Union[schemas_magazines.MagazineSubscription, PendingApproval])
@approval_gate.gated("magazines", "UPDATE", "MagazineSubscription", "magazines.write", id_param="sub_id")
def update_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    sub_id: int,
    sub_in: schemas_magazines.MagazineSubscriptionUpdate,
) -> Any:
    """Stop/start magazine delivery: set delivery_status to ACTIVE or STOPPED. The member's Yes / No follows it."""
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    data = sub_in.model_dump(exclude_unset=True)
    if "delivery_status" in data:
        if data["delivery_status"] not in VALID_DELIVERY_STATUSES:
            raise HTTPException(400, f"delivery_status must be one of {sorted(VALID_DELIVERY_STATUSES)}")
    if data.get("delivery_status") == "ACTIVE":      # starting (or restarting) is refused for someone who can never get the magazine
        owner = db.query(Member).filter(Member.id == sub.member_id).first()
        if owner is not None:
            _refuse_if_cannot_receive(owner)
    result = crud_magazines.subscription.update(db, db_obj=sub, obj_in=data, updated_by=current_user.id)
    if "delivery_status" in data:
        member = db.query(Member).filter(Member.id == sub.member_id).first()
        if member is not None:
            member.magazine_needed = data["delivery_status"] == "ACTIVE"
            from services.service_types import sync_magazine_optin
            sync_magazine_optin(db, member_id=sub.member_id, linked_id=sub.id if member.magazine_needed else None)
            db.commit()
    return result


@router.delete("/subscriptions/{sub_id}", response_model=Union[schemas_magazines.MagazineSubscription, PendingApproval])
@approval_gate.gated("magazines", "DELETE", "MagazineSubscription", "magazines.delete", id_param="sub_id")
def delete_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.delete")),
    sub_id: int,
) -> Any:
    """Remove a magazine subscription (the member's service opt-in for
    Magazine is cancelled, not deleted, so the profile keeps the history)."""
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    result = crud_magazines.subscription.remove(db, id=sub_id, deleted_by=current_user.id)
    from services.service_types import sync_magazine_optin
    sync_magazine_optin(db, member_id=sub.member_id, linked_id=None)
    member = db.query(Member).filter(Member.id == sub.member_id).first()
    if member is not None:
        member.magazine_needed = False  # otherwise a later receipt or edit would start it again
    db.commit()
    return result


# ─────────────── DELIVERY PAUSES ───────────────
@router.get("/pauses")
def read_pauses(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    subscription_id: Optional[int] = None,
    active_only: bool = False,
) -> Any:
    q = db.query(MagazineDeliveryPause).filter(MagazineDeliveryPause.is_deleted == False)
    if subscription_id:
        q = q.filter(MagazineDeliveryPause.subscription_id == subscription_id)
    if active_only:
        today = date.today()
        q = q.filter(
            MagazineDeliveryPause.pause_start_date <= today,
            (MagazineDeliveryPause.pause_end_date >= today)
            | (MagazineDeliveryPause.pause_end_date == None),  # noqa: E711
        )
    return paginate(q.order_by(MagazineDeliveryPause.id.desc()), page, _page_limit(limit))


@router.post("/pauses", response_model=Union[schemas_magazines.MagazineDeliveryPause, PendingApproval], status_code=201)
@approval_gate.gated("magazines", "CREATE", "MagazineDeliveryPause", "magazines.write")
def pause_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    pause_in: schemas_magazines.MagazineDeliveryPauseCreate
) -> Any:
    """Pause delivery for a period, with the member's note as the reason.

    Paused subscriptions are skipped by label generation for the pause span.
    """
    sub = db.query(MagazineSubscription).filter(
        MagazineSubscription.id == pause_in.subscription_id,
        MagazineSubscription.is_deleted == False,
    ).first()
    if not sub:
        raise HTTPException(404, "Subscription not found")
    if pause_in.pause_end_date and pause_in.pause_end_date < pause_in.pause_start_date:
        raise HTTPException(400, "pause_end_date cannot be before pause_start_date")

    # An open-ended pause must not stack: close any still-open pause first.
    open_pause = (
        db.query(MagazineDeliveryPause)
        .filter(
            MagazineDeliveryPause.subscription_id == pause_in.subscription_id,
            MagazineDeliveryPause.pause_end_date == None,  # noqa: E711
            MagazineDeliveryPause.is_deleted == False,
        )
        .first()
    )
    if open_pause:
        raise HTTPException(
            409,
            f"Pause {open_pause.id} is still open (no end date); resume it before pausing again",
        )

    created = crud_magazines.pause.create(db=db, obj_in=pause_in, created_by=current_user.id)
    # A pause that covers today flips the subscription to PAUSED (a STOPPED
    # subscription stays STOPPED).
    if sub.delivery_status == "ACTIVE" and pause_in.pause_start_date <= date.today() and (
        pause_in.pause_end_date is None or pause_in.pause_end_date >= date.today()
    ):
        sub.delivery_status = "PAUSED"
        sub.updated_by = current_user.id
        db.commit()
    return created


@router.get("/pauses/{pause_id}", response_model=schemas_magazines.MagazineDeliveryPause)
def read_pause(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), pause_id: int) -> Any:
    p = db.query(MagazineDeliveryPause).filter(MagazineDeliveryPause.id == pause_id, MagazineDeliveryPause.is_deleted == False).first()
    if not p: raise HTTPException(404, "Pause not found")
    return p

@router.delete("/pauses/{pause_id}")
@approval_gate.gated("magazines", "DELETE", "MagazineDeliveryPause", "magazines.delete", id_param="pause_id")
def delete_pause(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("magazines.delete")), pause_id: int) -> Any:
    p = db.query(MagazineDeliveryPause).filter(MagazineDeliveryPause.id == pause_id, MagazineDeliveryPause.is_deleted == False).first()
    if not p: raise HTTPException(404, "Pause not found")
    p.is_deleted = True; p.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

# ─────────────── MONTHLY MARKS (the 1–12 boxes) ───────────────
def _month_bounds(year: int, month: int):
    from calendar import monthrange
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _monthly_grid(db: Session, sub: MagazineSubscription, year: int) -> dict:
    """One box per month of `year`: 'R' = issue returned (not delivered),
    'P' = service paused that month, 'S' = the issue was sent (the member was on that month's label batch and that
    batch is marked Sent), '' = nothing recorded."""
    returns = {
        r.issue_month_year: r for r in db.query(MagazineReturn).filter(
            MagazineReturn.subscription_id == sub.id,
            MagazineReturn.is_deleted == False,  # noqa: E712
            MagazineReturn.issue_month_year.like(f"{year}-%"),
        ).all()
    }
    pauses = db.query(MagazineDeliveryPause).filter(
        MagazineDeliveryPause.subscription_id == sub.id,
        MagazineDeliveryPause.is_deleted == False,  # noqa: E712
    ).all()
    on_labels = {
        row[0] for row in db.query(MagazineLabelBatch.issue_month_year)
        .join(MagazineLabelBatchItem, MagazineLabelBatchItem.label_batch_id == MagazineLabelBatch.id)
        .filter(
            MagazineLabelBatchItem.recipient_type == "MEMBER",
            MagazineLabelBatchItem.recipient_id == sub.member_id,
            MagazineLabelBatch.issue_month_year.like(f"{year}-%"),
            MagazineLabelBatch.status == "SENT",
            MagazineLabelBatch.is_deleted == False,  # noqa: E712
        ).all()
    }
    sent = on_labels
    months = []
    for m in range(1, 13):
        first, last = _month_bounds(year, m)
        key = f"{year}-{m:02d}"
        ret = returns.get(key)
        pause = next((p for p in pauses if p.pause_start_date <= last and (p.pause_end_date is None or p.pause_end_date >= first)), None)
        months.append({
            "month": m, "issue_month_year": key,
            "mark": "R" if ret else ("P" if pause else ("S" if key in sent else "")),
            "sent": key in sent,
            "returned": bool(ret), "return_id": ret.id if ret else None,
            "return_reason": ret.return_reason if ret else None,
            "paused": bool(pause), "pause_reason": pause.reason if pause else None,
        })
    return months


def _recent_returns(db: Session, subscription_id: int, months: int = 12) -> int:
    today = date.today()
    y, m = today.year, today.month - (months - 1)
    while m <= 0:
        m += 12
        y -= 1
    since = f"{y}-{m:02d}"
    return db.query(MagazineReturn).filter(
        MagazineReturn.subscription_id == subscription_id,
        MagazineReturn.is_deleted == False,  # noqa: E712
        MagazineReturn.issue_month_year >= since,
    ).count()


def _grid_response(db: Session, sub: MagazineSubscription, year: int) -> dict:
    months = _monthly_grid(db, sub, year)
    recent = _recent_returns(db, sub.id)
    paused_now = sub.delivery_status == "PAUSED"
    return {
        "subscription_id": sub.id, "member_id": sub.member_id, "year": year,
        "delivery_status": sub.delivery_status,
        "months": months,
        "returned_in_year": sum(1 for x in months if x["returned"]),
        "returned_last_12_months": recent,
        # two or more returns in a year is the cue to pause the service
        "suggest_pause": recent >= 2 and not paused_now and sub.delivery_status == "ACTIVE",
    }


def build_subscription_history(db: Session, sub: MagazineSubscription) -> list:
    """Issue-by-issue history of one subscription, newest first. Per issue month: RETURNED (the copy came back),
    SENT (the member was on that month's label batch and the batch is marked Sent),
    PAUSED (delivery was paused that month) or LISTED (on the label list, not sent yet)."""
    issues: dict = {}

    labels = (
        db.query(MagazineLabelBatch, MagazineLabelBatchItem)
        .join(MagazineLabelBatchItem, MagazineLabelBatchItem.label_batch_id == MagazineLabelBatch.id)
        .filter(
            MagazineLabelBatchItem.recipient_type == "MEMBER",
            MagazineLabelBatchItem.recipient_id == sub.member_id,
            MagazineLabelBatch.status != "CANCELLED",
            MagazineLabelBatch.is_deleted == False,  # noqa: E712
        ).order_by(MagazineLabelBatch.id).all()
    )
    for batch, item in labels:
        issue = batch.issue_month_year
        extra = {"batch_id": batch.id, "batch_name": batch.batch_name, "label_address": item.label_address}
        if batch.status == "SENT":
            issues[issue] = {"result": "SENT", "date": batch.sent_date, "detail": batch.batch_name, **extra}
        elif issues.get(issue, {}).get("result") != "SENT":
            issues[issue] = {"result": "LISTED", "date": batch.generation_date, "detail": "labels generated, not marked sent", **extra}

    today = date.today()
    for p in db.query(MagazineDeliveryPause).filter(
        MagazineDeliveryPause.subscription_id == sub.id, MagazineDeliveryPause.is_deleted == False,  # noqa: E712
    ).all():
        y, m = p.pause_start_date.year, p.pause_start_date.month
        end = p.pause_end_date or today
        for _ in range(36):
            if (y, m) > (end.year, end.month):
                break
            key = f"{y}-{m:02d}"
            if issues.get(key, {}).get("result") != "SENT":
                issues[key] = {"result": "PAUSED", "date": p.pause_start_date, "detail": p.reason or "delivery paused"}
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    for r in db.query(MagazineReturn).filter(
        MagazineReturn.subscription_id == sub.id, MagazineReturn.is_deleted == False,  # noqa: E712
    ).all():
        issues[r.issue_month_year] = {**issues.get(r.issue_month_year, {}), "result": "RETURNED", "date": r.return_date,
                                      "detail": r.return_reason or "returned"}

    # months since the subscription began that never reached a label list or a pause
    if sub.created_at:
        y, m = sub.created_at.year, sub.created_at.month
        while (y, m) < (today.year, today.month):
            issues.setdefault(f"{y}-{m:02d}", {"result": "NOT_LISTED", "date": None, "detail": "not on any label list"})
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    return [{"issue_month_year": k, **v} for k, v in sorted(issues.items(), reverse=True)]


@router.get("/subscriptions/{sub_id}/history")
def subscription_history(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    sub_id: int,
) -> Any:
    sub = db.query(MagazineSubscription).filter(MagazineSubscription.id == sub_id, MagazineSubscription.is_deleted == False).first()  # noqa: E712
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return {"subscription_id": sub.id, "member_id": sub.member_id, "issues": build_subscription_history(db, sub)}


@router.get("/subscriptions/{sub_id}/monthly")
def subscription_monthly_marks(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    sub_id: int, year: Optional[int] = None,
) -> Any:
    sub = db.query(MagazineSubscription).filter(MagazineSubscription.id == sub_id, MagazineSubscription.is_deleted == False).first()  # noqa: E712
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return _grid_response(db, sub, year or date.today().year)


@router.get("/members/{member_id}/monthly")
def member_monthly_marks(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: int, year: Optional[int] = None,
) -> Any:
    """The member's 1–12 monthly boxes for the magazine (R = returned)."""
    sub = db.query(MagazineSubscription).filter(
        MagazineSubscription.member_id == member_id, MagazineSubscription.is_deleted == False,  # noqa: E712
    ).order_by(MagazineSubscription.id.desc()).first()
    if not sub:
        raise HTTPException(404, "This member has no magazine subscription")
    return _grid_response(db, sub, year or date.today().year)


@router.get("/returns/repeat")
def repeat_returns(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    min_returns: int = 2, months: int = 12, only_unpaused: bool = True,
    page: int = 1, limit: int = 50,
) -> Any:
    """Subscriptions whose magazine came back `min_returns`+ times in the
    last `months` months — candidates to pause until the address is fixed."""
    from sqlalchemy import func
    from models.members import Member

    today = date.today()
    y, m = today.year, today.month - (months - 1)
    while m <= 0:
        m += 12
        y -= 1
    since = f"{y}-{m:02d}"
    counts = (
        db.query(
            MagazineReturn.subscription_id.label("sid"),
            func.count(MagazineReturn.id).label("n"),
            func.max(MagazineReturn.issue_month_year).label("last_issue"),
        )
        .filter(MagazineReturn.is_deleted == False, MagazineReturn.issue_month_year >= since)  # noqa: E712
        .group_by(MagazineReturn.subscription_id)
        .having(func.count(MagazineReturn.id) >= min_returns)
        .subquery()
    )
    q = (
        db.query(MagazineSubscription, Member, counts.c.n, counts.c.last_issue)
        .join(counts, counts.c.sid == MagazineSubscription.id)
        .join(Member, Member.id == MagazineSubscription.member_id)
        .filter(MagazineSubscription.is_deleted == False)  # noqa: E712
    )
    if only_unpaused:
        q = q.filter(MagazineSubscription.delivery_status == "ACTIVE")
    total = q.count()
    rows = q.order_by(counts.c.n.desc(), MagazineSubscription.id).offset((max(page, 1) - 1) * limit).limit(limit).all()
    return {
        "total": total, "page": page, "limit": limit,
        "pages": (total + limit - 1) // limit,
        "data": [
            {
                "subscription_id": sub.id, "member_id": mem.id, "member_code": mem.member_code,
                "name": mem.display_name,
                "mobile": mem.mobile, "delivery_status": sub.delivery_status,
                "returns_in_period": n, "last_returned_issue": last_issue,
            }
            for sub, mem, n, last_issue in rows
        ],
    }


@router.get("/returns/{return_id}", response_model=schemas_magazines.MagazineReturn)
def read_return(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), return_id: int) -> Any:
    r = db.query(MagazineReturn).filter(MagazineReturn.id == return_id, MagazineReturn.is_deleted == False).first()
    if not r: raise HTTPException(404, "Return not found")
    return r

@router.get("/delivery-batches/{batch_id}", response_model=schemas_magazines.MagazineDeliveryBatch)
def read_delivery_batch(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), batch_id: int) -> Any:
    b = db.query(MagazineDeliveryBatch).filter(MagazineDeliveryBatch.id == batch_id, MagazineDeliveryBatch.is_deleted == False).first()
    if not b: raise HTTPException(404, "Delivery batch not found")
    return b

@router.put("/pauses/{pause_id}", response_model=Union[schemas_magazines.MagazineDeliveryPause, PendingApproval])
@approval_gate.gated("magazines", "UPDATE", "MagazineDeliveryPause", "magazines.write", id_param="pause_id")
def update_pause(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    pause_id: int,
    pause_in: schemas_magazines.MagazineDeliveryPauseUpdate,
) -> Any:
    """Adjust a pause (extend/shorten the window, update the note)."""
    pause = db.query(MagazineDeliveryPause).filter(
        MagazineDeliveryPause.id == pause_id,
        MagazineDeliveryPause.is_deleted == False,
    ).first()
    if not pause:
        raise HTTPException(404, "Pause not found")
    data = pause_in.model_dump(exclude_unset=True)
    end = data.get("pause_end_date", pause.pause_end_date)
    if end and end < pause.pause_start_date:
        raise HTTPException(400, "pause_end_date cannot be before pause_start_date")
    return crud_magazines.pause.update(db, db_obj=pause, obj_in=data, updated_by=current_user.id)


@router.post("/pauses/{pause_id}/resume", response_model=Union[schemas_magazines.MagazineDeliveryPause, PendingApproval])
@approval_gate.gated("magazines", "CREATE", "MagazineDeliveryPauseResume", "magazines.write", id_param="pause_id")
def resume_pause(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    pause_id: int,
    resume_date: Optional[date] = None,
) -> Any:
    """Resume (start) delivery again: closes the pause on the given date (default today)."""
    pause = db.query(MagazineDeliveryPause).filter(
        MagazineDeliveryPause.id == pause_id,
        MagazineDeliveryPause.is_deleted == False,
    ).first()
    if not pause:
        raise HTTPException(404, "Pause not found")
    if pause.pause_end_date:
        raise HTTPException(400, "Pause is already closed")
    end = resume_date or date.today()
    if end < pause.pause_start_date:
        raise HTTPException(400, "resume date cannot be before pause_start_date")
    pause.pause_end_date = end
    pause.updated_by = current_user.id
    sub = db.query(MagazineSubscription).filter(MagazineSubscription.id == pause.subscription_id).first()
    if sub and sub.delivery_status == "PAUSED" and end <= date.today():
        still_paused = db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.subscription_id == sub.id,
            MagazineDeliveryPause.id != pause.id,
            MagazineDeliveryPause.is_deleted == False,  # noqa: E712
            MagazineDeliveryPause.pause_start_date <= date.today(),
            (MagazineDeliveryPause.pause_end_date == None) | (MagazineDeliveryPause.pause_end_date >= date.today()),  # noqa: E711
        ).first()
        if not still_paused:
            sub.delivery_status = "ACTIVE"
    db.commit()
    db.refresh(pause)
    return pause


# ─────────────── RETURNS ───────────────
@router.get("/returns")
def read_returns(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
    subscription_id: Optional[int] = None,
    member_id: Optional[int] = None,
    issue_month_year: Optional[str] = None,
    follow_up_status: Optional[str] = None,
) -> Any:
    q = db.query(MagazineReturn).filter(MagazineReturn.is_deleted == False)
    if subscription_id: q = q.filter(MagazineReturn.subscription_id == subscription_id)
    if member_id:
        q = q.join(MagazineSubscription, MagazineSubscription.id == MagazineReturn.subscription_id).filter(
            MagazineSubscription.member_id == member_id
        )
    if issue_month_year: q = q.filter(MagazineReturn.issue_month_year == issue_month_year)
    if follow_up_status: q = q.filter(MagazineReturn.follow_up_status == follow_up_status)
    return paginate(q.order_by(MagazineReturn.id.desc()), page, _page_limit(limit))


@router.post("/returns", response_model=Union[schemas_magazines.MagazineReturn, PendingApproval], status_code=201)
@approval_gate.gated("magazines", "CREATE", "MagazineReturn", "magazines.write")
def create_return(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    return_in: schemas_magazines.MagazineReturnCreate,
) -> Any:
    """Mark a magazine return for a member's subscription and issue month.

    The member's profile and future label prints highlight returned issues.
    """
    import re

    subscription = db.query(MagazineSubscription).filter(
        MagazineSubscription.id == return_in.subscription_id,
        MagazineSubscription.is_deleted == False,
    ).first()
    if not subscription:
        raise HTTPException(404, "Subscription not found")
    if not re.match(r"^\d{4}-\d{2}$", return_in.issue_month_year or ""):
        raise HTTPException(400, "issue_month_year must be in YYYY-MM format")

    duplicate = db.query(MagazineReturn).filter(
        MagazineReturn.subscription_id == return_in.subscription_id,
        MagazineReturn.issue_month_year == return_in.issue_month_year,
        MagazineReturn.is_deleted == False,
    ).first()
    if duplicate:
        raise HTTPException(409, f"Issue {return_in.issue_month_year} is already marked returned (id={duplicate.id})")
    # a copy can only come back if it was posted: the member must be on a label batch of that issue that is marked Sent
    sent_to_member = (
        db.query(MagazineLabelBatchItem.id)
        .join(MagazineLabelBatch, MagazineLabelBatch.id == MagazineLabelBatchItem.label_batch_id)
        .filter(
            MagazineLabelBatchItem.recipient_type == "MEMBER",
            MagazineLabelBatchItem.recipient_id == subscription.member_id,
            MagazineLabelBatch.issue_month_year == return_in.issue_month_year,
            MagazineLabelBatch.status == "SENT",
            MagazineLabelBatch.is_deleted == False,  # noqa: E712
        ).first()
    )
    if not sent_to_member:
        raise HTTPException(409, f"Issue {return_in.issue_month_year} was not sent to this member: the member must be on a printed label "
                                 "batch of that issue.")

    obj = MagazineReturn(**return_in.model_dump(), created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/returns/{return_id}", response_model=Union[schemas_magazines.MagazineReturn, PendingApproval])
@approval_gate.gated("magazines", "UPDATE", "MagazineReturn", "magazines.write", id_param="return_id")
def update_return(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    return_id: int,
    return_in: schemas_magazines.MagazineReturnUpdate,
) -> Any:
    """Follow up on a return (PENDING → CONTACTED → RESOLVED) or amend the reason."""
    obj = db.query(MagazineReturn).filter(
        MagazineReturn.id == return_id,
        MagazineReturn.is_deleted == False,
    ).first()
    if not obj:
        raise HTTPException(404, "Return not found")
    data = return_in.model_dump(exclude_unset=True)
    if "follow_up_status" in data and data["follow_up_status"] not in VALID_FOLLOW_UP_STATUSES:
        raise HTTPException(400, f"follow_up_status must be one of {sorted(VALID_FOLLOW_UP_STATUSES)}")
    return _update_return(db, obj, data, current_user.id)


def _update_return(db: Session, obj: MagazineReturn, data: dict, user_id: int) -> MagazineReturn:
    for field, value in data.items():
        setattr(obj, field, value)
    obj.updated_by = user_id
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/returns/{return_id}", response_model=Union[schemas_magazines.MagazineReturn, PendingApproval])
@approval_gate.gated("magazines", "DELETE", "MagazineReturn", "magazines.delete", id_param="return_id")
def delete_return(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.delete")),
    return_id: int,
) -> Any:
    """Undo a return marking (e.g. entered in the wrong month)."""
    obj = db.query(MagazineReturn).filter(
        MagazineReturn.id == return_id,
        MagazineReturn.is_deleted == False,
    ).first()
    if not obj:
        raise HTTPException(404, "Return not found")
    return _soft_delete_return(db, obj, current_user.id)


def _soft_delete_return(db: Session, obj: MagazineReturn, user_id: int) -> MagazineReturn:
    obj.is_deleted = True
    obj.deleted_by = user_id
    db.commit()
    db.refresh(obj)
    return obj


# ─────────────── DELIVERY BATCHES ───────────────
@router.get("/delivery-batches")
def read_delivery_batches(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
) -> Any:
    return paginate(
        db.query(MagazineDeliveryBatch)
        .filter(MagazineDeliveryBatch.is_deleted == False)
        .order_by(MagazineDeliveryBatch.id.desc()),
        page, _page_limit(limit),
    )


# ─────────────── LABEL GENERATION ───────────────
def _member_label_address(member) -> str:
    """Postal address lines for a label: street lines, then the village-style
    parts (area / place / grama / village), then the locality."""
    lines = [
        ", ".join(p for p in (member.address_line1, member.address_line2) if p),
        ", ".join(p for p in (member.area, member.place, member.grama, member.village) if p),
        member.locality or "",
    ]
    return chr(10).join(l for l in lines if l)


def _in_postal_order(db: Session, rows: list) -> list:
    """(subscription, member) rows sorted by district, taluk, pincode and name, so a district-wise run prints in post-office order."""
    from models.masters import District, PostalCode, Taluk
    if not rows:
        return rows
    districts = {d.id: d.name_en for d in db.query(District).all()}
    taluks = {t.id: t.name_en for t in db.query(Taluk).all()}
    pins = {p.id: p.pincode for p in db.query(PostalCode).filter(PostalCode.id.in_({m.pincode_id for _s, m in rows if m.pincode_id})).all()} if any(m.pincode_id for _s, m in rows) else {}
    key = lambda r: (districts.get(r[1].district_id) or "~", taluks.get(r[1].taluk_id) or "~", pins.get(r[1].pincode_id) or "~", (r[1].full_name_en or "").upper())  # noqa: E731
    return sorted(rows, key=key)


@router.post("/generate-labels")
@approval_gate.gated("magazines", "CREATE", "MagazineLabelBatch", "magazines.write")
def generate_labels(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    issue_month_year: str,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    only_paid: bool = False,
    force: bool = False,
) -> Any:
    """Generate (print) a magazine label batch (state/district/taluk-wise), in district, taluk and pincode order. Printing
    marks the batch SENT on today's date: a copy can be marked returned from then on.

    The list is everyone with an ACTIVE subscription who wants the printed copy: approved members, and applicants who have paid (a
    subscription starts for an applicant when a receipt is assigned). Stopped subscriptions, expired or deleted members and rejected
    applicants are excluded, a pause that covers the issue month is skipped, returned issues are flagged. Paying is not checked here (the
    subscription itself says who is on the list); only_paid=True is kept for a caller that wants it. Affiliations, associates and press
    are added only when no state, district or taluk filter is given. A batch for the same issue and filters that is not cancelled is
    refused (409) unless force=true.
    """
    from models.engagements import Affiliation, Associate, PressMedia
    from models.receipts import ReceiptAllocation
    from datetime import date as dt
    import re

    if not re.match(r"^\d{4}-\d{2}$", issue_month_year):
        raise HTTPException(400, "issue_month_year must be in YYYY-MM format")

    filters_text = str({
        "state_id": state_id, "district_id": district_id,
        "taluk_id": taluk_id, "only_paid": only_paid,
    })
    twin = db.query(MagazineLabelBatch).filter(
        MagazineLabelBatch.issue_month_year == issue_month_year,
        MagazineLabelBatch.filters_applied == filters_text,
        MagazineLabelBatch.status != "CANCELLED",
        MagazineLabelBatch.is_deleted == False,  # noqa: E712
    ).first()
    if twin and not force:
        raise HTTPException(409, f"A label batch for {issue_month_year} with the same filters already exists "
                                 f"({twin.batch_name}, {twin.status.title()}). Cancel it, or generate another one anyway.")

    batch = MagazineLabelBatch(
        batch_name=f"Labels-{issue_month_year}",
        generation_date=dt.today(),
        issue_month_year=issue_month_year,
        filters_applied=filters_text,
        status="SENT",                 # printing the labels IS sending the issue (the office's rule): no separate "mark sent" step
        sent_date=dt.today(),
        created_by=current_user.id
    )
    db.add(batch)
    db.flush()

    items = []
    today = dt.today()

    member_subs = (
        db.query(MagazineSubscription, Member)
        .join(Member, Member.id == MagazineSubscription.member_id)
        .filter(
            MagazineSubscription.delivery_status == "ACTIVE",
            MagazineSubscription.is_deleted == False,
            Member.is_deleted == False,
            Member.approval_status.in_(("APPROVED", "UNAPPROVED")),   # an applicant is on the list once paid (that is when the subscription starts)
            Member.member_status == "ACTIVE",                         # never an expired or deleted member
            # a member who wants only the e-copy gets no posted label
            or_(Member.magazine_kind.is_(None), Member.magazine_kind != "EMAIL"),
        )
    )
    if state_id: member_subs = member_subs.filter(Member.state_id == state_id)
    if district_id: member_subs = member_subs.filter(Member.district_id == district_id)
    if taluk_id: member_subs = member_subs.filter(Member.taluk_id == taluk_id)

    rows = member_subs.all()
    rows = _in_postal_order(db, rows)

    if only_paid and rows:
        member_ids = {m.id for _, m in rows}
        paid_ids = {
            row[0] for row in
            db.query(ReceiptAllocation.member_id)
            .filter(
                ReceiptAllocation.member_id.in_(member_ids),
                ReceiptAllocation.is_deleted == False,
            )
            .distinct()
            .all()
        }
        rows = [(sub, m) for sub, m in rows if m.id in paid_ids]

    # a pause skips the member when it covers any day of the issue month
    first_day, last_day = _month_bounds(int(issue_month_year[:4]), int(issue_month_year[5:7]))
    paused_sub_ids = {
        p.subscription_id for p in
        db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.pause_start_date <= last_day,
            (MagazineDeliveryPause.pause_end_date >= first_day) | (MagazineDeliveryPause.pause_end_date == None),  # noqa: E711
            MagazineDeliveryPause.is_deleted == False
        ).all()
    }

    return_sub_ids = {
        r.subscription_id for r in
        db.query(MagazineReturn).filter(MagazineReturn.issue_month_year == issue_month_year).all()
    }

    for sub, member in rows:
        if sub.id in paused_sub_ids:
            continue
        address = sub.address_override or getattr(member, "magazine_delivery_address", None) or _member_label_address(member)
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id,
            recipient_type="MEMBER",
            recipient_id=member.id,
            label_address=address,
            is_return=sub.id in return_sub_ids,
            created_by=current_user.id
        ))

    from models.engagements import AffiliationMagazineSetting, AssociateMagazineSetting, PressMediaMagazineSetting

    filtered_by_place = bool(state_id or district_id or taluk_id)   # affiliations, associates and press have no place filter: they join a full run only

    def _override(model, fk, owner):
        r = db.query(model).filter(getattr(model, fk) == owner.id, model.is_deleted == False).first()
        return r.address_override if r and r.address_override else None

    for aff in ([] if filtered_by_place else db.query(Affiliation).filter(Affiliation.magazine_enabled == True, Affiliation.is_deleted == False).all()):  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="AFFILIATION",
            recipient_id=aff.id, label_address=_override(AffiliationMagazineSetting, 'affiliation_id', aff) or aff.address, created_by=current_user.id
        ))

    for assoc in ([] if filtered_by_place else db.query(Associate).filter(Associate.magazine_enabled == True, Associate.is_deleted == False).all()):  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="ASSOCIATE",
            recipient_id=assoc.id, label_address=_override(AssociateMagazineSetting, 'associate_id', assoc) or assoc.address, created_by=current_user.id
        ))

    for press in ([] if filtered_by_place else db.query(PressMedia).filter(PressMedia.magazine_enabled == True, PressMedia.is_deleted == False).all()):  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="PRESS",
            recipient_id=press.id, label_address=_override(PressMediaMagazineSetting, 'press_media_id', press) or press.address, created_by=current_user.id
        ))

    db.bulk_save_objects(items)
    batch.total_labels = len(items)
    db.commit()

    return {
        "batch_id": batch.id,
        "total_labels": len(items),
        "issue": issue_month_year,
        "returned_count": sum(1 for i in items if i.is_return),
    }


# KYC Link
@router.post("/members/{member_id}/send-kyc-link")
# Not @approval_gate.gated: takes a BackgroundTasks param (see the note on
# approve_member in members.py).
async def send_kyc_link(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    member_id: int,
    background_tasks: BackgroundTasks,
    channel: str = "LINK",  # LINK (WhatsApp link) or APP (app notification nudge)
) -> Any:
    """Send a KYC update request to a member.

    channel=LINK (default): member without the mobile app gets a secure link
    on WhatsApp. channel=APP: member with the app gets a nudge to open the
    KYC screen in the app. Both are tracked as MemberKycRequest rows.
    """
    from services import kyc as kyc_service

    if channel not in ("LINK", "APP"):
        raise HTTPException(400, "channel must be LINK or APP")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member or not member.mobile:
        raise HTTPException(404, "Member not found or has no mobile number")

    kyc, token = kyc_service.create_kyc_request(db, member, created_by=current_user.id)
    msg = (
        kyc_service.link_message(member, token)
        if channel == "LINK"
        else kyc_service.app_message(member)
    )

    async def _send():
        await whatsapp_service.send_message(
            to=f"{member.mobile_country_code}{member.mobile}", message=msg
        )

    background_tasks.add_task(_send)
    response = {
        "message": f"KYC request sent via WhatsApp ({channel})",
        "channel": channel,
        "expires_at": kyc.expires_at,
    }
    if channel == "LINK":
        response["kyc_url"] = kyc_service.kyc_link_url(token)
    return response


@router.post("/members/kyc-reminders")
# Not @approval_gate.gated: takes a BackgroundTasks param (see the note on
# send_kyc_link above).
def send_kyc_reminders(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    background_tasks: BackgroundTasks,
    interval_days: int = 180,
    channel: str = "LINK",
    limit: int = 500,
) -> Any:
    """Scan approved, active members and (re)send the KYC update request to
    anyone who has never been asked, or whose last request was sent more
    than `interval_days` days ago — the "regular specified intervals" nudge
    the spec calls for. Like POST /notifications/expiry-reminders, this is
    run on a schedule: set SCHEDULER_ENABLED + KYC_REMINDER_ENABLED to
    have services.scheduler call this daily, or hit it from cron.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func

    from services import kyc as kyc_service

    if channel not in ("LINK", "APP"):
        raise HTTPException(400, "channel must be LINK or APP")

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=interval_days)

    def _aware(dt):
        """SQLite returns naive datetimes; assume they are UTC."""
        return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt

    last_sent_subq = (
        db.query(
            MemberKycRequest.member_id.label("member_id"),
            func.max(MemberKycRequest.sent_at).label("last_sent_at"),
        )
        .group_by(MemberKycRequest.member_id)
        .subquery()
    )

    rows = (
        db.query(Member, last_sent_subq.c.last_sent_at)
        .outerjoin(last_sent_subq, last_sent_subq.c.member_id == Member.id)
        .filter(
            Member.is_deleted == False,  # noqa: E712
            Member.member_status == "ACTIVE",
            Member.approval_status == "APPROVED",
            Member.mobile.isnot(None),
        )
        .all()
    )

    eligible = []
    for member, last_sent_at in rows:
        if _aware(last_sent_at) is None or _aware(last_sent_at) < cutoff:
            eligible.append(member)
        if len(eligible) >= limit:
            break

    queued = []
    for member in eligible:
        kyc, token = kyc_service.create_kyc_request(db, member, created_by=current_user.id)
        msg = (
            kyc_service.link_message(member, token)
            if channel == "LINK"
            else kyc_service.app_message(member)
        )

        async def _send(mobile_country_code=member.mobile_country_code, mobile=member.mobile, message=msg):
            await whatsapp_service.send_message(to=f"{mobile_country_code}{mobile}", message=message)

        background_tasks.add_task(_send)
        queued.append(member.id)

    return {
        "queued": len(queued),
        "member_ids": queued,
        "interval_days": interval_days,
        "channel": channel,
    }


# ─── LABEL BATCHES ────────────────────────────────────────
@router.get("/label-batches")
def read_label_batches(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
) -> Any:
    """Generated label batches (the 'generated' side of the labels report)."""
    q = db.query(MagazineLabelBatch).filter(MagazineLabelBatch.is_deleted == False)
    return paginate(q.order_by(MagazineLabelBatch.id.desc()), page, _page_limit(limit))


def _batch_row(batch: MagazineLabelBatch) -> dict:
    return {"id": batch.id, "batch_name": batch.batch_name, "issue_month_year": batch.issue_month_year, "status": batch.status,
            "sent_date": batch.sent_date, "total_labels": batch.total_labels, "cancel_reason": batch.cancel_reason}


def _label_batch(db: Session, batch_id: int) -> MagazineLabelBatch:
    batch = db.query(MagazineLabelBatch).filter(MagazineLabelBatch.id == batch_id, MagazineLabelBatch.is_deleted == False).first()  # noqa: E712
    if not batch:
        raise HTTPException(404, "Label batch not found")
    return batch


@router.post("/label-batches/{batch_id}/send")
def mark_label_batch_sent(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    batch_id: int, sent_date: Optional[date] = None,
) -> Any:
    """A printed batch is already Sent (printing is sending). This only corrects the posted date, when the labels were posted on a
    day other than the print day; a cancelled batch cannot be changed."""
    batch = _label_batch(db, batch_id)
    if batch.status == "CANCELLED":
        raise HTTPException(409, "This batch is cancelled; its posted date cannot be changed.")
    sent_on = sent_date or batch.sent_date or date.today()
    if sent_on > date.today():
        raise HTTPException(400, "The sent date cannot be in the future.")
    batch.status, batch.sent_date, batch.updated_by = "SENT", sent_on, current_user.id
    db.commit()
    return _batch_row(batch)


def _returns_marked_on(db: Session, batch: MagazineLabelBatch):
    """A return marked on this batch's issue for a member who is on the batch (None when there is none)."""
    return (
        db.query(MagazineReturn.id)
        .join(MagazineSubscription, MagazineSubscription.id == MagazineReturn.subscription_id)
        .join(MagazineLabelBatchItem, (MagazineLabelBatchItem.recipient_id == MagazineSubscription.member_id) & (MagazineLabelBatchItem.recipient_type == "MEMBER"))
        .filter(
            MagazineLabelBatchItem.label_batch_id == batch.id,
            MagazineReturn.issue_month_year == batch.issue_month_year,
            MagazineReturn.is_deleted == False,  # noqa: E712
        ).first()
    )


@router.post("/label-batches/{batch_id}/cancel")
def cancel_label_batch(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    batch_id: int, reason: Optional[str] = None,
) -> Any:
    """A batch printed wrongly: cancel it. Once a return is marked for the issue it can no longer be cancelled."""
    batch = _label_batch(db, batch_id)
    if batch.status == "CANCELLED":
        raise HTTPException(409, "This batch is already cancelled.")
    if _returns_marked_on(db, batch):
        raise HTTPException(409, "Returns are already marked for this issue; remove them before cancelling the batch.")
    batch.status, batch.cancel_reason, batch.updated_by = "CANCELLED", (reason or getattr(db, "_action_reason", None) or None), current_user.id
    db.commit()
    return _batch_row(batch)


def _label_names(db: Session, items) -> dict:
    """Resolve (recipient_type, recipient_id) → display name in bulk."""
    from models.engagements import Affiliation, Associate, PressMedia
    from models.members import Member

    names = {}
    wanted = {}
    for item in items:
        wanted.setdefault(item.recipient_type, set()).add(item.recipient_id)

    if "MEMBER" in wanted:
        for m in db.query(Member).filter(Member.id.in_(wanted["MEMBER"])).all():
            names[("MEMBER", m.id)] = m.display_name
    if "AFFILIATION" in wanted:
        for a in db.query(Affiliation).filter(Affiliation.id.in_(wanted["AFFILIATION"])).all():
            names[("AFFILIATION", a.id)] = a.group_name
    if "ASSOCIATE" in wanted:
        for a in db.query(Associate).filter(Associate.id.in_(wanted["ASSOCIATE"])).all():
            names[("ASSOCIATE", a.id)] = a.name
    if "PRESS" in wanted:
        for p in db.query(PressMedia).filter(PressMedia.id.in_(wanted["PRESS"])).all():
            names[("PRESS", p.id)] = p.organization_name
    return names


@router.get("/label-batches/{batch_id}")
def read_label_batch(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    batch_id: int,
    returns_only: bool = False,
    recipient_type: Optional[str] = None,   # MEMBER | AFFILIATION | ASSOCIATE | PRESS
    page: int = 1,
    limit: int = 25,
) -> Any:
    """Label batch detail, one page of the labels (at most 200); returns_only=True lists just the returned issues."""
    batch = db.query(MagazineLabelBatch).filter(
        MagazineLabelBatch.id == batch_id,
        MagazineLabelBatch.is_deleted == False,
    ).first()
    if not batch:
        raise HTTPException(404, "Label batch not found")

    q = db.query(MagazineLabelBatchItem).filter(
        MagazineLabelBatchItem.label_batch_id == batch_id,
        MagazineLabelBatchItem.is_deleted == False,
    )
    if returns_only:
        q = q.filter(MagazineLabelBatchItem.is_return == True)  # noqa: E712
    if recipient_type and recipient_type.upper() != "ALL":
        q = q.filter(MagazineLabelBatchItem.recipient_type == recipient_type.upper())
    limit = _page_limit(limit)
    page = max(1, page)
    total_items = q.count()
    items = q.order_by(MagazineLabelBatchItem.id).offset((page - 1) * limit).limit(limit).all()
    names = _label_names(db, items)

    return {
        "batch": {
            "id": batch.id,
            "batch_name": batch.batch_name,
            "issue_month_year": batch.issue_month_year,
            "generation_date": batch.generation_date,
            "total_labels": batch.total_labels,
            "filters_applied": batch.filters_applied,
            "status": batch.status,
            "sent_date": batch.sent_date,
        },
        "total": total_items,
        "page": page,
        "limit": limit,
        "pages": (total_items + limit - 1) // limit,
        "data": [
            {
                "id": item.id,
                "recipient_type": item.recipient_type,
                "recipient_id": item.recipient_id,
                "recipient_name": names.get((item.recipient_type, item.recipient_id)),
                "label_address": item.label_address,
                "is_return": item.is_return,
            }
            for item in items
        ],
    }


@router.get("/label-batches/{batch_id}/pdf")
def download_label_pdf(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    batch_id: int,
) -> Any:
    """Render a label batch as a printable A4 PDF (3×7 grid), highlighting
    returned issues, and remember the generated file on the batch."""
    import os

    from fpdf import FPDF
    from fastapi.responses import FileResponse

    from models.members import Member

    batch = db.query(MagazineLabelBatch).filter(
        MagazineLabelBatch.id == batch_id,
        MagazineLabelBatch.is_deleted == False,
    ).first()
    if not batch:
        raise HTTPException(404, "Label batch not found")

    items = (
        db.query(MagazineLabelBatchItem)
        .filter(
            MagazineLabelBatchItem.label_batch_id == batch_id,
            MagazineLabelBatchItem.is_deleted == False,
        )
        .order_by(MagazineLabelBatchItem.id)
        .all()
    )
    names = _label_names(db, items)
    member_ids = {i.recipient_id for i in items if i.recipient_type == "MEMBER"}
    member_codes = {
        m.id: m.member_code or m.membership_number
        for m in db.query(Member).filter(Member.id.in_(member_ids or {0})).all()
    }

    # Noto Sans (Latin) + Noto Sans Kannada, with HarfBuzz shaping so Kannada
    # conjuncts render correctly. Latin is primary; Kannada is the fallback.
    fonts = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "assets", "fonts")
    cols, rows = 3, 7
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_title(f"Labels {batch.batch_name}")
    pdf.add_font("Lbl", "", os.path.join(fonts, "NotoSans-Regular.ttf"))
    pdf.add_font("Lbl", "B", os.path.join(fonts, "NotoSans-Bold.ttf"))
    pdf.add_font("LblKn", "", os.path.join(fonts, "NotoSansKannada-Regular.ttf"))
    pdf.add_font("LblKn", "B", os.path.join(fonts, "NotoSansKannada-Bold.ttf"))
    pdf.set_fallback_fonts(["LblKn"])
    pdf.set_text_shaping(True)

    label_w, label_h = pdf.w / cols, pdf.h / rows
    per_page = cols * rows

    pdf.add_page()
    if not items:
        pdf.set_font("Lbl", "", 12)
        pdf.text(10, 15, "No labels in this batch.")
    for index, item in enumerate(items):
        slot = index % per_page
        if index and slot == 0:
            pdf.add_page()
        x = (slot % cols) * label_w
        y = (slot // cols) * label_h

        # the pre-cut sticker sheet has its own outline: no box is drawn; Times like the printed stickers (Latin text),
        # Noto only when a character is not Latin-1 (Kannada and the like)
        pdf.set_text_color(0, 0, 0)
        name = names.get((item.recipient_type, item.recipient_id), item.recipient_type.title())
        code = member_codes.get(item.recipient_id) if item.recipient_type == "MEMBER" else None
        text = item.label_address or ""
        try:
            f"{code or ''}{name}{text}".encode("latin-1")
            face = "Times"
        except UnicodeEncodeError:
            face = "Lbl"
        inner_w = label_w - 10
        left = x + 5
        pdf.set_xy(left, y + 7)
        pdf.set_font(face, "", 10)
        if code:
            pdf.multi_cell(inner_w, 4.2, str(code), max_line_height=4.2)
        pdf.set_font(face, "B", 10)
        pdf.set_x(left)
        pdf.multi_cell(inner_w, 4.4, name.upper() if face == "Times" else name, max_line_height=4.4)
        pdf.set_font(face, "", 10.5)
        pdf.set_x(left)
        # keep the address inside the label
        remaining = (y + label_h - 5) - pdf.get_y()
        max_lines = max(int(remaining // 4.2), 1)
        wrapped = pdf.multi_cell(inner_w, 4.2, text, dry_run=True, output="LINES")
        pdf.multi_cell(inner_w, 4.2, chr(10).join(wrapped[:max_lines]))
        if item.is_return:
            pdf.set_text_color(190, 0, 0)
            pdf.set_font("Lbl", "B", 8)
            pdf.text(x + 3, y + label_h - 3, "RETURNED ISSUE")
            pdf.set_text_color(0, 0, 0)

    pdf_bytes = bytes(pdf.output())

    folder = os.path.join(settings.UPLOAD_DIR, "label_batches")
    os.makedirs(folder, exist_ok=True)
    filename = f"labels_{batch.id}_{batch.issue_month_year}.pdf"
    filepath = os.path.join(folder, filename)
    with open(filepath, "wb") as fh:
        fh.write(pdf_bytes)
    batch.file_path = filepath
    batch.updated_by = current_user.id
    db.commit()

    return FileResponse(
        filepath,
        media_type="application/pdf",
        filename=filename,
    )


# ─────────────── BACKFILL & UNIFIED RECIPIENTS ───────────────
@router.get("/unsubscribed-paid-members")
def read_unsubscribed_paid_members(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.read")),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 25,
) -> Any:
    """Members who requested the magazine (magazine_needed=True) and have paid receipt allocations,
    but have no active magazine subscription. One page at a time (at most 200, rule 10.6) with the whole total."""
    from core.pagination import LIST_PAGE_MAX
    from models.receipts import ReceiptAllocation
    from sqlalchemy import func

    limit = max(1, min(limit, LIST_PAGE_MAX))
    page = max(1, page)
    subscribed = db.query(MagazineSubscription.member_id).filter(
        MagazineSubscription.is_deleted == False,  # noqa: E712
        MagazineSubscription.delivery_status == "ACTIVE",
    )
    paid = (
        db.query(Member, func.sum(ReceiptAllocation.allocated_amount).label("total_allocated"))
        .join(ReceiptAllocation, ReceiptAllocation.member_id == Member.id)
        .filter(
            Member.is_deleted == False,  # noqa: E712
            Member.magazine_needed == True,  # noqa: E712
            Member.approval_status.in_(("APPROVED", "UNAPPROVED")),   # an applicant who has paid is on the list too
            Member.member_status == "ACTIVE",      # an expired or deleted member never gets the magazine, so is never listed to be started
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            ~Member.id.in_(subscribed),
        )
    )
    if search and search.strip():
        like = f"%{search.strip()}%"
        paid = paid.filter(or_(
            Member.full_name_en.ilike(like), Member.mobile.ilike(like),
            Member.member_code.ilike(like), Member.membership_number.ilike(like),
        ))
    paid = paid.group_by(Member.id)
    total = paid.count()
    results = []
    for member, total_allocated in paid.order_by(Member.id.desc()).offset((page - 1) * limit).limit(limit).all():
        results.append(
            schemas_magazines.UnsubscribedPaidMember(
                member_id=member.id,
                member_code=member.member_code or member.membership_number,
                name=member.display_name or member.full_name_kn or f"Member {member.id}",
                mobile=member.mobile,
                magazine_needed=member.magazine_needed,
                magazine_delivery_address=member.magazine_delivery_address,
                total_allocated=float(total_allocated or 0.0),
            )
        )
    return {"data": results, "total": total, "page": page, "limit": limit, "pages": (total + limit - 1) // limit}


@router.post("/backfill-subscriptions")
def backfill_subscriptions(
    payload: schemas_magazines.BackfillSubscriptionsRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
) -> Any:
    """One-time creation of magazine subscriptions for approved existing paid members."""
    from services.magazine_subscriptions import ensure_subscription_on_receipt_assigned

    created_count = ensure_subscription_on_receipt_assigned(
        db, payload.member_ids, user_id=current_user.id
    )
    db.commit()
    return {
        "created_count": created_count,
        "processed_ids": payload.member_ids,
        "message": f"Successfully activated {created_count} magazine subscription(s)."
    }


@router.get("/all-recipients", response_model=List[schemas_magazines.MagazineRecipientItem])
def read_all_recipients(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.read")),
    recipient_type: Optional[str] = None,
    delivery_status: Optional[str] = None,
    search: Optional[str] = None,
) -> Any:
    """Combined list of magazine recipients: members with subscriptions, affiliations, associates, and press.
    LEGACY: at most the first 200; the Subscriptions screen reads the paged GET /magazines/recipients."""
    return _collect_recipients(db, recipient_type, delivery_status, search)[:LIST_PAGE_MAX]


def _collect_recipients(db: Session, recipient_type: Optional[str], delivery_status: Optional[str], search: Optional[str], *,
                        copy: Optional[str] = None, state_id: Optional[int] = None, district_id: Optional[int] = None,
                        taluk_id: Optional[int] = None, receipt: Optional[str] = None) -> list:
    """Every recipient matching the type, status, search and the other filters (not paged).

    Recipient types: MEMBER = approved members, APPLICANT = members not approved yet (rejected ones are left out),
    AFFILIATION, ASSOCIATE and PRESS. A person is listed when they said Yes to the magazine or already have a subscription;
    with no subscription their status is NOT_STARTED. copy = PRINTED | ONLINE. A place filter (state, district, taluk) lists
    people only (an affiliation, associate or press has no place). receipt = PAID | NO_RECEIPT (people only)."""
    from sqlalchemy import and_, exists
    from models.receipts import Receipt, ReceiptAllocation
    from models.engagements import Affiliation, AffiliationMagazineSetting, Associate, AssociateMagazineSetting, PressMedia, PressMediaMagazineSetting

    recipients: List[schemas_magazines.MagazineRecipientItem] = []

    kind = (recipient_type or "ALL").upper()
    wanted_copy = (copy or "").upper()
    place_filtered = bool(state_id or district_id or taluk_id)
    non_member_filtered = bool(wanted_copy == "ONLINE" or place_filtered or receipt)   # these filters describe people only

    # 1. PEOPLE: approved members and applicants
    if kind in ("ALL", "MEMBER", "APPLICANT"):
        approvals = {"MEMBER": ("APPROVED",), "APPLICANT": ("UNAPPROVED",)}.get(kind, ("APPROVED", "UNAPPROVED"))
        paid_exists = exists().where(and_(
            ReceiptAllocation.member_id == Member.id, ReceiptAllocation.is_deleted == False,  # noqa: E712
            ReceiptAllocation.receipt_id == Receipt.id, Receipt.is_deleted == False, Receipt.receipt_status != "CANCELLED",  # noqa: E712
        ))
        q = (
            db.query(MagazineSubscription, Member, paid_exists.label("paid"))
            .select_from(Member)
            .outerjoin(MagazineSubscription, and_(MagazineSubscription.member_id == Member.id, MagazineSubscription.is_deleted == False))  # noqa: E712
            .filter(
                Member.is_deleted == False,  # noqa: E712
                Member.approval_status.in_(approvals),
                or_(MagazineSubscription.id.isnot(None), Member.magazine_needed == True),  # noqa: E712
            )
        )
        if delivery_status and delivery_status.upper() != "ALL":
            if delivery_status.upper() == "NOT_STARTED":
                q = q.filter(MagazineSubscription.id.is_(None))
            else:
                q = q.filter(MagazineSubscription.delivery_status == delivery_status.upper())
        if wanted_copy == "PRINTED":
            q = q.filter(or_(Member.magazine_kind.is_(None), Member.magazine_kind != "EMAIL"))
        elif wanted_copy == "ONLINE":
            q = q.filter(Member.magazine_kind == "EMAIL")
        if state_id: q = q.filter(Member.state_id == state_id)
        if district_id: q = q.filter(Member.district_id == district_id)
        if taluk_id: q = q.filter(Member.taluk_id == taluk_id)
        if (receipt or "").upper() == "PAID":
            q = q.filter(paid_exists)
        elif (receipt or "").upper() == "NO_RECEIPT":
            q = q.filter(~paid_exists)
        if search:
            s = f"%{search}%"
            q = q.filter(
                (Member.full_name_en.ilike(s)) |
                (Member.first_name_en.ilike(s)) |
                (Member.last_name_en.ilike(s)) |
                (Member.member_code.ilike(s)) |
                (Member.mobile.ilike(s))
            )
        for sub, m, paid in q.all():
            name = m.display_name or m.full_name_kn or f"Member {m.id}"
            recipients.append(
                schemas_magazines.MagazineRecipientItem(
                    recipient_type="MEMBER" if m.approval_status == "APPROVED" else "APPLICANT",
                    recipient_id=m.id,
                    name=name,
                    code_or_reg=m.member_code or m.membership_number,
                    mobile=m.mobile,
                    delivery_status=sub.delivery_status if sub else "NOT_STARTED",
                    copy_kind="ONLINE" if m.magazine_kind == "EMAIL" else "PRINTED",
                    member_status=m.member_status,
                    has_receipt=bool(paid),
                    address=_member_label_address(m),
                    address_override=(sub.address_override if sub else None) or getattr(m, "magazine_delivery_address", None),
                    state_id=m.state_id,
                    district_id=m.district_id,
                    taluk_id=m.taluk_id,
                )
            )

    # Helper for non-members
    def _get_setting(setting_model, fk_field, owner_id):
        return db.query(setting_model).filter(
            getattr(setting_model, fk_field) == owner_id,
            setting_model.is_deleted == False,  # noqa: E712
        ).first()

    # 2. AFFILIATIONS
    if kind in ("ALL", "AFFILIATION") and not non_member_filtered:
        q_aff = db.query(Affiliation).filter(Affiliation.is_deleted == False)  # noqa: E712
        if search:
            s = f"%{search}%"
            q_aff = q_aff.filter(
                (Affiliation.group_name.ilike(s)) |
                (Affiliation.contact_person.ilike(s)) |
                (Affiliation.contact_number.ilike(s))
            )
        for aff in q_aff.all():
            setting = _get_setting(AffiliationMagazineSetting, "affiliation_id", aff.id)
            is_enabled = aff.magazine_enabled and (setting.enabled if setting else True)
            stat = "ACTIVE" if is_enabled else "STOPPED"
            if delivery_status and delivery_status.upper() != "ALL" and stat != delivery_status.upper():
                continue
            recipients.append(
                schemas_magazines.MagazineRecipientItem(
                    recipient_type="AFFILIATION",
                    recipient_id=aff.id,
                    name=aff.group_name,
                    code_or_reg=aff.contact_person,
                    mobile=aff.contact_number,
                    delivery_status=stat,
                    address=aff.address,
                    address_override=setting.address_override if setting else None,
                )
            )

    # 3. ASSOCIATES
    if kind in ("ALL", "ASSOCIATE") and not non_member_filtered:
        q_asc = db.query(Associate).filter(Associate.is_deleted == False)  # noqa: E712
        if search:
            s = f"%{search}%"
            q_asc = q_asc.filter(
                (Associate.name.ilike(s)) |
                (Associate.organization.ilike(s)) |
                (Associate.associate_number.ilike(s)) |
                (Associate.mobile.ilike(s))
            )
        for asc in q_asc.all():
            setting = _get_setting(AssociateMagazineSetting, "associate_id", asc.id)
            is_enabled = asc.magazine_enabled and (setting.enabled if setting else True)
            stat = "ACTIVE" if is_enabled else "STOPPED"
            if delivery_status and delivery_status.upper() != "ALL" and stat != delivery_status.upper():
                continue
            recipients.append(
                schemas_magazines.MagazineRecipientItem(
                    recipient_type="ASSOCIATE",
                    recipient_id=asc.id,
                    name=asc.name,
                    code_or_reg=asc.associate_number or asc.organization,
                    mobile=asc.mobile,
                    delivery_status=stat,
                    address=asc.address,
                    address_override=setting.address_override if setting else None,
                )
            )

    # 4. PRESS & MEDIA
    if kind in ("ALL", "PRESS") and not non_member_filtered:
        q_prs = db.query(PressMedia).filter(PressMedia.is_deleted == False)  # noqa: E712
        if search:
            s = f"%{search}%"
            q_prs = q_prs.filter(
                (PressMedia.organization_name.ilike(s)) |
                (PressMedia.reporter_name.ilike(s)) |
                (PressMedia.mobile.ilike(s))
            )
        for prs in q_prs.all():
            setting = _get_setting(PressMediaMagazineSetting, "press_media_id", prs.id)
            is_enabled = prs.magazine_enabled and (setting.enabled if setting else True)
            stat = "ACTIVE" if is_enabled else "STOPPED"
            if delivery_status and delivery_status.upper() != "ALL" and stat != delivery_status.upper():
                continue
            recipients.append(
                schemas_magazines.MagazineRecipientItem(
                    recipient_type="PRESS",
                    recipient_id=prs.id,
                    name=prs.organization_name,
                    code_or_reg=prs.reporter_name,
                    mobile=prs.mobile,
                    delivery_status=stat,
                    address=prs.address,
                    address_override=setting.address_override if setting else None,
                )
            )

    return recipients


@router.get("/recipients")
def read_recipients_page(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.read")),
    page: int = 1,
    limit: int = 25,
    recipient_type: Optional[str] = None,   # ALL | MEMBER (approved) | APPLICANT (not approved yet) | AFFILIATION | ASSOCIATE | PRESS
    delivery_status: Optional[str] = None,  # ACTIVE | PAUSED | STOPPED | NOT_STARTED
    search: Optional[str] = None,
    with_returns: bool = False,   # members whose subscription has a returned issue
    copy: Optional[str] = None,       # PRINTED | ONLINE
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    receipt: Optional[str] = None,    # PAID | NO_RECEIPT
) -> Any:
    """One page of the combined recipients (approved members, applicants, affiliations, associates, press). The search
    and the filters run on all of them; `summary` counts the whole set matching the type, the search and the other filters,
    whatever the status filter, and a person's row carries their subscription, the pause running today and its returned-issue count."""
    from models.magazines import MagazineReturn

    everything = _collect_recipients(db, recipient_type, None, search, copy=copy, state_id=state_id, district_id=district_id,
                                     taluk_id=taluk_id, receipt=receipt)
    summary = {"total": len(everything), "active": 0, "paused": 0, "stopped": 0, "not_started": 0}
    for r in everything:
        key = {"ACTIVE": "active", "PAUSED": "paused", "NOT_STARTED": "not_started"}.get(r.delivery_status, "stopped")
        summary[key] += 1

    rows = everything
    if delivery_status and delivery_status.upper() != "ALL":
        rows = [r for r in rows if r.delivery_status == delivery_status.upper()]

    returned_sub_ids = {
        sid for (sid,) in db.query(MagazineReturn.subscription_id).filter(MagazineReturn.is_deleted == False).distinct().all()  # noqa: E712
    }
    if with_returns:
        members_with_returns = {
            mid for (mid,) in db.query(MagazineSubscription.member_id).filter(
                MagazineSubscription.id.in_(returned_sub_ids or {0}), MagazineSubscription.is_deleted == False  # noqa: E712
            ).all()
        }
        rows = [r for r in rows if r.recipient_type in ("MEMBER", "APPLICANT") and r.recipient_id in members_with_returns]

    limit = _page_limit(limit)
    page = max(1, page)
    total = len(rows)
    window = rows[(page - 1) * limit: page * limit]

    # the member rows of this page: their subscription, the running pause and the returns
    member_ids = [r.recipient_id for r in window if r.recipient_type in ("MEMBER", "APPLICANT")]
    subs = {}
    if member_ids:
        from core.pagination import _to_plain
        for sub in db.query(MagazineSubscription).filter(
            MagazineSubscription.member_id.in_(member_ids), MagazineSubscription.is_deleted == False  # noqa: E712
        ).all():
            subs[sub.member_id] = sub
    today = date.today()
    pauses = {}
    counts = {}
    if subs:
        sub_ids = [s.id for s in subs.values()]
        for p in db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.subscription_id.in_(sub_ids), MagazineDeliveryPause.is_deleted == False,  # noqa: E712
            MagazineDeliveryPause.pause_start_date <= today,
            (MagazineDeliveryPause.pause_end_date >= today) | (MagazineDeliveryPause.pause_end_date == None),  # noqa: E711
        ).all():
            pauses.setdefault(p.subscription_id, p)
        from sqlalchemy import func as _func
        for sid, n in db.query(MagazineReturn.subscription_id, _func.count()).filter(
            MagazineReturn.subscription_id.in_(sub_ids), MagazineReturn.is_deleted == False  # noqa: E712
        ).group_by(MagazineReturn.subscription_id).all():
            counts[sid] = n

    from core.pagination import _to_plain
    data = []
    for r in window:
        item = r.model_dump()
        if r.recipient_type in ("MEMBER", "APPLICANT"):
            sub = subs.get(r.recipient_id)
            item["subscription"] = _to_plain(sub, set()) if sub else None
            pause = pauses.get(sub.id) if sub else None
            item["active_pause"] = _to_plain(pause, set()) if pause else None
            item["return_count"] = counts.get(sub.id, 0) if sub else 0
        data.append(item)
    return {"total": total, "page": page, "limit": limit, "pages": (total + limit - 1) // limit, "data": data, "summary": summary}

