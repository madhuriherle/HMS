from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.members import Member, MemberKycRequest
from models.magazines import (
    MagazineDeliveryBatch,
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

@router.get("/subscriptions")
def read_subscriptions(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    delivery_status: Optional[str] = None,
) -> Any:
    q = db.query(MagazineSubscription).filter(MagazineSubscription.is_deleted == False)
    if delivery_status: q = q.filter(MagazineSubscription.delivery_status == delivery_status)
    return paginate(q, page, limit)

@router.post("/subscriptions", response_model=schemas_magazines.MagazineSubscription)
def create_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    sub_in: schemas_magazines.MagazineSubscriptionCreate
) -> Any:
    return crud_magazines.subscription.create(db=db, obj_in=sub_in, created_by=current_user.id)

@router.put("/subscriptions/{id}")
def update_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    id: int, status: str
) -> Any:
    sub = crud_magazines.subscription.get(db, id)
    if not sub: raise HTTPException(404, "Subscription not found")
    sub.delivery_status = status
    sub.updated_by = current_user.id
    db.commit()
    return {"message": f"Subscription status updated to {status}"}

@router.post("/pauses", response_model=schemas_magazines.MagazineDeliveryPause)
def pause_subscription(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    pause_in: schemas_magazines.MagazineDeliveryPauseCreate
) -> Any:
    return crud_magazines.pause.create(db=db, obj_in=pause_in, created_by=current_user.id)

@router.get("/returns")
def read_returns(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
    issue_month_year: Optional[str] = None,
) -> Any:
    q = db.query(MagazineReturn).filter(MagazineReturn.is_deleted == False)
    if issue_month_year:
        q = q.filter(MagazineReturn.issue_month_year == issue_month_year)
    return paginate(q, page, limit)

@router.post("/returns", response_model=schemas_magazines.MagazineReturn)
def create_return(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    return_in: schemas_magazines.MagazineReturnCreate,
) -> Any:
    subscription = db.query(MagazineSubscription).filter(
        MagazineSubscription.id == return_in.subscription_id,
        MagazineSubscription.is_deleted == False,
    ).first()
    if not subscription:
        raise HTTPException(404, "Subscription not found")
    obj = MagazineReturn(**return_in.model_dump(), created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.get("/delivery-batches")
def read_delivery_batches(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
) -> Any:
    return paginate(db.query(MagazineDeliveryBatch).filter(MagazineDeliveryBatch.is_deleted == False), page, limit)

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

@router.post("/generate-labels")
def generate_labels(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    issue_month_year: str,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
) -> Any:
    """
    Generate magazine label batch.
    Combines active members, affiliates, associates and press/media.
    Excludes paused subscriptions and marks returned ones.
    """
    from models.engagements import Affiliation, Associate, PressMedia
    from datetime import date as dt

    # Create the batch record
    batch = MagazineLabelBatch(
        batch_name=f"Labels-{issue_month_year}",
        generation_date=dt.today(),
        issue_month_year=issue_month_year,
        filters_applied=str({"district_id": district_id, "taluk_id": taluk_id}),
        created_by=current_user.id
    )
    db.add(batch)
    db.flush()

    items = []
    today = dt.today()

    # Members with active subscriptions (excluding paused)
    from models.magazines import MagazineDeliveryPause
    member_subs = (
        db.query(MagazineSubscription, Member)
        .join(Member, Member.id == MagazineSubscription.member_id)
        .filter(
            MagazineSubscription.delivery_status == "ACTIVE",
            MagazineSubscription.is_deleted == False,
            Member.is_deleted == False,
        )
    )
    if district_id: member_subs = member_subs.filter(Member.district_id == district_id)
    if taluk_id: member_subs = member_subs.filter(Member.taluk_id == taluk_id)

    paused_sub_ids = {
        p.subscription_id for p in
        db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.pause_start_date <= today,
            (MagazineDeliveryPause.pause_end_date >= today) | (MagazineDeliveryPause.pause_end_date == None),
            MagazineDeliveryPause.is_deleted == False
        ).all()
    }

    return_sub_ids = {
        r.subscription_id for r in
        db.query(MagazineReturn).filter(MagazineReturn.issue_month_year == issue_month_year).all()
    }

    for sub, member in member_subs.all():
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

    # Affiliates
    for aff in db.query(Affiliation).filter(Affiliation.magazine_enabled == True, Affiliation.is_deleted == False).all():
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="AFFILIATION",
            recipient_id=aff.id, label_address=aff.address, created_by=current_user.id
        ))

    # Associates
    for assoc in db.query(Associate).filter(Associate.magazine_enabled == True, Associate.is_deleted == False).all():
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="ASSOCIATE",
            recipient_id=assoc.id, label_address=assoc.address, created_by=current_user.id
        ))

    # Press / Media
    for press in db.query(PressMedia).filter(PressMedia.magazine_enabled == True, PressMedia.is_deleted == False).all():
        items.append(MagazineLabelBatchItem(
            label_batch_id=batch.id, recipient_type="PRESS",
            recipient_id=press.id, label_address=press.address, created_by=current_user.id
        ))

    db.bulk_save_objects(items)
    batch.total_labels = len(items)
    db.commit()

    return {"batch_id": batch.id, "total_labels": len(items), "issue": issue_month_year}

# KYC Link
@router.post("/members/{member_id}/send-kyc-link")
async def send_kyc_link(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("magazines.write")),
    member_id: int,
    background_tasks: BackgroundTasks,
) -> Any:
    """Generate a secure KYC update link and send via WhatsApp."""
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member or not member.mobile:
        raise HTTPException(404, "Member not found or has no mobile number")

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    kyc = MemberKycRequest(
        member_id=member_id,
        # Only the SHA-256 of the token is stored — a DB leak must not allow
        # forging KYC links.
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        sent_to=member.mobile,
        sent_at=now,
        expires_at=now.replace(hour=23, minute=59, second=0, microsecond=0),
        status="SENT",
        created_by=current_user.id
    )
    db.add(kyc)
    db.commit()

    kyc_url = f"https://hms-mma.app/kyc?token={token}"
    msg = f"Dear {member.first_name_en}, please update your KYC details using this link (valid today): {kyc_url}"

    async def _send():
        await whatsapp_service.send_message(
            to=f"{member.mobile_country_code}{member.mobile}", message=msg
        )

    background_tasks.add_task(_send)
    return {
        "message": "KYC link sent via WhatsApp",
        "kyc_url": kyc_url,
        "expires_at": kyc.expires_at,
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
