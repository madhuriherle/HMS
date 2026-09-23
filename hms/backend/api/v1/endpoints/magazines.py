from typing import Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
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
from crud import magazines as crud_magazines
from core.config import settings
from core.pagination import paginate
from services.whatsapp import whatsapp_service
from datetime import datetime, date, timezone
import hashlib
import secrets

router = APIRouter()

VALID_DELIVERY_STATUSES = {"ACTIVE", "STOPPED", "CANCELLED"}
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
) -> Any:
    q = db.query(MagazineSubscription).filter(MagazineSubscription.is_deleted == False)
    if member_id: q = q.filter(MagazineSubscription.member_id == member_id)
    if delivery_status: q = q.filter(MagazineSubscription.delivery_status == delivery_status)
    return paginate(q.order_by(MagazineSubscription.id.desc()), page, limit)


@router.get("/subscriptions/{sub_id}", response_model=schemas_magazines.MagazineSubscription)
def read_subscription(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), sub_id: int
) -> Any:
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return sub


@router.post("/subscriptions", response_model=schemas_magazines.MagazineSubscription, status_code=201)
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
    existing = _get_member_subscription(db, sub_in.member_id)
    if existing:
        raise HTTPException(409, f"Member already has a subscription (id={existing.id}, status={existing.delivery_status})")
    return crud_magazines.subscription.create(db=db, obj_in=sub_in, created_by=current_user.id)


@router.put("/subscriptions/{sub_id}", response_model=schemas_magazines.MagazineSubscription)
def update_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    sub_id: int,
    sub_in: schemas_magazines.MagazineSubscriptionUpdate,
) -> Any:
    """Stop/start magazine delivery: set delivery_status to ACTIVE, STOPPED or CANCELLED."""
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    data = sub_in.model_dump(exclude_unset=True)
    if "delivery_status" in data:
        if data["delivery_status"] not in VALID_DELIVERY_STATUSES:
            raise HTTPException(400, f"delivery_status must be one of {sorted(VALID_DELIVERY_STATUSES)}")
    return crud_magazines.subscription.update(db, db_obj=sub, obj_in=data, updated_by=current_user.id)


@router.delete("/subscriptions/{sub_id}", response_model=schemas_magazines.MagazineSubscription)
def delete_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    sub_id: int,
) -> Any:
    sub = crud_magazines.subscription.get(db, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return crud_magazines.subscription.remove(db, id=sub_id, deleted_by=current_user.id)


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
    return paginate(q.order_by(MagazineDeliveryPause.id.desc()), page, limit)


@router.post("/pauses", response_model=schemas_magazines.MagazineDeliveryPause, status_code=201)
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

    return crud_magazines.pause.create(db=db, obj_in=pause_in, created_by=current_user.id)


@router.put("/pauses/{pause_id}", response_model=schemas_magazines.MagazineDeliveryPause)
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


@router.post("/pauses/{pause_id}/resume", response_model=schemas_magazines.MagazineDeliveryPause)
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
    return paginate(q.order_by(MagazineReturn.id.desc()), page, limit)


@router.post("/returns", response_model=schemas_magazines.MagazineReturn, status_code=201)
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

    obj = MagazineReturn(**return_in.model_dump(), created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/returns/{return_id}", response_model=schemas_magazines.MagazineReturn)
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


@router.delete("/returns/{return_id}", response_model=schemas_magazines.MagazineReturn)
def delete_return(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
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
        page, limit,
    )


@router.post("/delivery-batches", response_model=schemas_magazines.MagazineDeliveryBatch)
def create_delivery_batch(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    batch_in: schemas_magazines.MagazineDeliveryBatchCreate,
) -> Any:
    batch = MagazineDeliveryBatch(**batch_in.model_dump(), created_by=current_user.id)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


# ─────────────── LABEL GENERATION ───────────────
@router.post("/generate-labels")
def generate_labels(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    issue_month_year: str,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    only_paid: bool = False,
) -> Any:
    """Generate a magazine label batch (state/district/taluk-wise).

    Members with STOPPED/CANCELLED subscriptions are excluded, active pauses
    are skipped, returned issues are flagged. only_paid=True restricts the
    member list to members whose subscription has a receipt allocation
    ('receipt generated members').
    """
    from models.engagements import Affiliation, Associate, PressMedia
    from models.receipts import ReceiptAllocation
    from datetime import date as dt
    import re

    if not re.match(r"^\d{4}-\d{2}$", issue_month_year):
        raise HTTPException(400, "issue_month_year must be in YYYY-MM format")

    batch = MagazineLabelBatch(
        batch_name=f"Labels-{issue_month_year}",
        generation_date=dt.today(),
        issue_month_year=issue_month_year,
        filters_applied=str({
            "state_id": state_id, "district_id": district_id,
            "taluk_id": taluk_id, "only_paid": only_paid,
        }),
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
        )
    )
    if state_id: member_subs = member_subs.filter(Member.state_id == state_id)
    if district_id: member_subs = member_subs.filter(Member.district_id == district_id)
    if taluk_id: member_subs = member_subs.filter(Member.taluk_id == taluk_id)

    rows = member_subs.all()

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

    paused_sub_ids = {
        p.subscription_id for p in
        db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.pause_start_date <= today,
            (MagazineDeliveryPause.pause_end_date >= today) | (MagazineDeliveryPause.pause_end_date == None),  # noqa: E711
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
        address = sub.address_override or f"{member.address_line1 or ''}, {member.locality or ''}"
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id,
            recipient_type="MEMBER",
            recipient_id=member.id,
            label_address=address,
            is_return=sub.id in return_sub_ids,
            created_by=current_user.id
        ))

    for aff in db.query(Affiliation).filter(Affiliation.magazine_enabled == True, Affiliation.is_deleted == False).all():  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="AFFILIATION",
            recipient_id=aff.id, label_address=aff.address, created_by=current_user.id
        ))

    for assoc in db.query(Associate).filter(Associate.magazine_enabled == True, Associate.is_deleted == False).all():  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="ASSOCIATE",
            recipient_id=assoc.id, label_address=assoc.address, created_by=current_user.id
        ))

    for press in db.query(PressMedia).filter(PressMedia.magazine_enabled == True, PressMedia.is_deleted == False).all():  # noqa: E712
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="PRESS",
            recipient_id=press.id, label_address=press.address, created_by=current_user.id
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
        response["kyc_url"] = f"{kyc_service.KYC_BASE_URL}?token={token}"
    return response


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
    return paginate(q.order_by(MagazineLabelBatch.id.desc()), page, limit)


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
            names[("MEMBER", m.id)] = " ".join(
                p for p in (m.first_name_en, m.last_name_en) if p
            )
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
) -> Any:
    """Label batch detail; returns_only=True lists just the returned issues."""
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
    items = q.order_by(MagazineLabelBatchItem.id).all()
    names = _label_names(db, items)

    return {
        "batch": {
            "id": batch.id,
            "batch_name": batch.batch_name,
            "issue_month_year": batch.issue_month_year,
            "generation_date": batch.generation_date,
            "total_labels": batch.total_labels,
            "filters_applied": batch.filters_applied,
        },
        "total": len(items),
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
    import io
    import os

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas

    from fastapi.responses import FileResponse

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

    def wrap(canvas, text, font, size, max_width):
        lines = []
        for paragraph in (text or "").splitlines() or [""]:
            words = paragraph.split()
            if not words:
                lines.append("")
                continue
            current = words[0]
            for word in words[1:]:
                trial = f"{current} {word}"
                if canvas.stringWidth(trial, font, size) <= max_width:
                    current = trial
                else:
                    lines.append(current)
                    current = word
            lines.append(current)
        return lines

    page_w, page_h = A4
    cols, rows = 3, 7
    label_w, label_h = page_w / cols, page_h / rows
    per_page = cols * rows

    buffer = io.BytesIO()
    canvas = pdf_canvas.Canvas(buffer, pagesize=A4)
    canvas.setTitle(f"Labels {batch.batch_name}")

    if not items:
        canvas.setFont("Helvetica", 12)
        canvas.drawString(40, page_h - 40, "No labels in this batch.")
    for index, item in enumerate(items):
        slot = index % per_page
        if index and slot == 0:
            canvas.showPage()
        col = slot % cols
        page_row = slot // cols
        x = col * label_w
        y_top = page_h - page_row * label_h

        canvas.setStrokeColorRGB(0.65, 0.65, 0.65)
        canvas.setFillColorRGB(0, 0, 0)
        canvas.rect(x + 2, y_top - label_h + 2, label_w - 4, label_h - 4)

        y = y_top - 11
        canvas.setFont("Helvetica-Bold", 9)
        name = names.get((item.recipient_type, item.recipient_id), item.recipient_type.title())
        canvas.drawString(x + 6, y, name[:42])
        y -= 11
        canvas.setFont("Helvetica", 8)
        for line in wrap(canvas, item.label_address, "Helvetica", 8, label_w - 14)[:6]:
            canvas.drawString(x + 6, y, line[:48])
            y -= 9.5
        if item.is_return:
            canvas.setFillColorRGB(0.75, 0, 0)
            canvas.setFont("Helvetica-Bold", 8)
            canvas.drawString(x + 6, y_top - label_h + 7, "RETURNED ISSUE")
            canvas.setFillColorRGB(0, 0, 0)

    canvas.save()

    folder = os.path.join(settings.UPLOAD_DIR, "label_batches")
    os.makedirs(folder, exist_ok=True)
    filename = f"labels_{batch.id}_{batch.issue_month_year}.pdf"
    filepath = os.path.join(folder, filename)
    with open(filepath, "wb") as fh:
        fh.write(buffer.getvalue())
    batch.file_path = filepath
    batch.updated_by = current_user.id
    db.commit()

    return FileResponse(
        filepath,
        media_type="application/pdf",
        filename=filename,
    )
