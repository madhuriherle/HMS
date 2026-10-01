from typing import Any, List, Optional, Union
import secrets

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, UploadFile, File
from sqlalchemy import or_ as sa_or
from sqlalchemy.orm import Session
from api import deps
from core.config import settings
from models.users import User
from models.members import Member
from models.notifications import (
    NotificationCampaign,
    NotificationDeliveryLog,
    NotificationImportBatch,
    NotificationMessage,
    NotificationRecipient,
    NotificationTemplate,
)
from services.whatsapp import whatsapp_service
from services.template_renderer import render, template_variables
from core.pagination import paginate
from schemas import notifications as schemas_notifications
from schemas.common import PendingApproval
from services import approval_gate
import models.inbox  # noqa: F401  # register inbox tables on Base.metadata

router = APIRouter()

# Purposes the reminder/scan flow looks up. A template with one of these
# purposes and an active status drives the expiry reminder campaign.
EXPIRY_PURPOSE = "MEMBERSHIP_EXPIRY"
VALID_MEMBER_FILTERS = {
    "district_id", "taluk_id", "state_id", "gender", "approval_status",
    "member_status", "membership_type_id", "registration_source",
}


def _member_variables(m: Member) -> dict:
    """Standard {{placeholders}} resolved from a member row."""
    return {
        "name": " ".join(p for p in (m.first_name_en, m.last_name_en) if p),
        "full_name_kn": m.full_name_kn or "",
        "member_code": m.member_code or "",
        "mobile": m.mobile or "",
    }


def _finish_campaign(campaign_id: int, results: list) -> None:
    """Record campaign + per-recipient delivery status in a fresh session."""
    from db.session import SessionLocal

    db = SessionLocal()
    try:
        campaign = db.get(NotificationCampaign, campaign_id)
        if campaign:
            ok = sum(1 for r in results if r.get("ok"))
            if ok == len(results):
                campaign.status = "SENT"
            elif ok:
                campaign.status = "PARTIAL"
            else:
                campaign.status = "FAILED"
        recipients = (
            db.query(NotificationRecipient)
            .filter(
                NotificationRecipient.campaign_id == campaign_id,
                NotificationRecipient.is_deleted == False,
            )
            .order_by(NotificationRecipient.id)
            .all()
        )
        # send_bulk preserves recipient order, and ids are minted in the same
        # order the recipients were created, so the lists line up.
        for recipient, result in zip(recipients, results):
            recipient.status = "SENT" if result.get("ok") else "FAILED"
        db.commit()
    finally:
        db.close()


@router.get("/templates")
def read_templates(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 50, purpose: Optional[str] = None) -> Any:
    q = db.query(NotificationTemplate).filter(NotificationTemplate.is_deleted == False)
    if purpose:
        q = q.filter(NotificationTemplate.purpose == purpose)
    return paginate(q, page, limit)

@router.post("/templates", response_model=Union[schemas_notifications.NotificationTemplate, PendingApproval])
@approval_gate.gated("notifications", "CREATE", "NotificationTemplate", "notifications.create")
def create_template(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    template_in: schemas_notifications.NotificationTemplateCreate,
) -> Any:
    from crud import notifications as crud_notif
    return crud_notif.template.create(db=db, obj_in=template_in, created_by=current_user.id)

@router.get("/templates/{template_id}", response_model=schemas_notifications.NotificationTemplate)
def read_template(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), template_id: int) -> Any:
    t = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id, NotificationTemplate.is_deleted == False).first()
    if not t:
        raise HTTPException(404, "Template not found")
    return t

@router.put("/templates/{template_id}", response_model=Union[schemas_notifications.NotificationTemplate, PendingApproval])
@approval_gate.gated("notifications", "UPDATE", "NotificationTemplate", "notifications.update", id_param="template_id")
def update_template(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.update")),
    template_id: int, template_in: schemas_notifications.NotificationTemplateUpdate,
) -> Any:
    t = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id, NotificationTemplate.is_deleted == False).first()
    if not t:
        raise HTTPException(404, "Template not found")
    for k, v in template_in.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    t.updated_by = current_user.id
    db.commit(); db.refresh(t)
    return t

@router.delete("/templates/{template_id}")
@approval_gate.gated("notifications", "DELETE", "NotificationTemplate", "notifications.delete", id_param="template_id")
def delete_template(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.delete")),
    template_id: int,
) -> Any:
    t = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id, NotificationTemplate.is_deleted == False).first()
    if not t:
        raise HTTPException(404, "Template not found")
    in_use = db.query(NotificationCampaign).filter(
        NotificationCampaign.template_id == template_id,
        NotificationCampaign.is_deleted == False,
        NotificationCampaign.status.in_(("PENDING", "SCHEDULED", "QUEUED")),
    ).count()
    if in_use:
        raise HTTPException(409, "Template is used by an unsent campaign; delete or change that campaign first")
    t.is_deleted = True; t.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

@router.get("/templates/{template_id}/variables")
def read_template_variables(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    template_id: int,
) -> Any:
    """The {{placeholders}} a template expects, so the UI can ask for values."""
    template = db.query(NotificationTemplate).filter(
        NotificationTemplate.id == template_id, NotificationTemplate.is_deleted == False
    ).first()
    if not template:
        raise HTTPException(404, "Template not found")
    return {"template_id": template.id, "variables": template_variables(template.content)}


@router.get("/campaigns")
def read_campaigns(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    q = db.query(NotificationCampaign).filter(NotificationCampaign.is_deleted == False)
    if status:
        q = q.filter(NotificationCampaign.status == status)
    return paginate(q.order_by(NotificationCampaign.id.desc()), page, limit)


@router.get("/campaigns/{campaign_id}/recipients")
def read_campaign_recipients(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    campaign_id: int,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """Per-recipient delivery status of a campaign."""
    campaign = db.query(NotificationCampaign).filter(
        NotificationCampaign.id == campaign_id, NotificationCampaign.is_deleted == False
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    q = db.query(NotificationRecipient).filter(
        NotificationRecipient.campaign_id == campaign_id,
        NotificationRecipient.is_deleted == False,
    )
    return paginate(q.order_by(NotificationRecipient.id), page, limit)


@router.post("/campaigns", response_model=Union[schemas_notifications.NotificationCampaign, PendingApproval])
@approval_gate.gated("notifications", "CREATE", "NotificationCampaign", "notifications.create")
def create_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    campaign_in: schemas_notifications.NotificationCampaignCreate,
) -> Any:
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == campaign_in.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    filters = campaign_in.member_filters
    if filters:
        unknown = set(filters) - VALID_MEMBER_FILTERS
        if unknown:
            raise HTTPException(400, f"Unknown member filters: {', '.join(sorted(unknown))}")
    campaign = NotificationCampaign(**campaign_in.model_dump(), created_by=current_user.id)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def _resolve_member_recipients(db: Session, member_filters: Optional[dict]) -> List[Member]:
    """Members matching the campaign/bulk filters (default: all active)."""
    filters = member_filters or {}
    q = db.query(Member).filter(
        Member.mobile != None,  # noqa: E711
        Member.is_deleted == False,
    )
    if not filters:
        q = q.filter(Member.member_status == "ACTIVE")
    if filters.get("district_id"):
        q = q.filter(Member.district_id == filters["district_id"])
    if filters.get("taluk_id"):
        q = q.filter(Member.taluk_id == filters["taluk_id"])
    if filters.get("state_id"):
        q = q.filter(Member.state_id == filters["state_id"])
    if filters.get("gender"):
        q = q.filter(Member.gender == filters["gender"])
    if filters.get("approval_status"):
        q = q.filter(Member.approval_status == filters["approval_status"])
    if filters.get("member_status"):
        q = q.filter(Member.member_status == filters["member_status"])
    if filters.get("registration_source"):
        q = q.filter(Member.registration_source == filters["registration_source"])
    if filters.get("membership_type_id"):
        from models.members import MemberMembership
        q = q.join(MemberMembership, MemberMembership.member_id == Member.id).filter(
            MemberMembership.membership_type_id == filters["membership_type_id"],
            MemberMembership.is_deleted == False,
        )
    return q.all()


def _resolve_csv_recipients(db: Session, campaign_id: int) -> List[dict]:
    """Recipients of a CSV import batch: [{mobile, member_id, variables}]."""
    batch = (
        db.query(NotificationImportBatch)
        .filter(
            NotificationImportBatch.campaign_id == campaign_id,
            NotificationImportBatch.is_deleted == False,
        )
        .order_by(NotificationImportBatch.id.desc())
        .first()
    )
    if not batch or not batch.file_path:
        return []
    import csv
    import os

    recipients: List[dict] = []
    seen: set = set()
    try:
        with open(batch.file_path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                mobile = (row.get("mobile") or "").strip()
                if not mobile or mobile in seen:
                    continue
                seen.add(mobile)
                member = db.query(Member).filter(
                    Member.mobile == mobile, Member.is_deleted == False
                ).first() if mobile.isdigit() else None
                variables = {k: v for k, v in row.items() if k != "mobile" and v}
                recipients.append({
                    "mobile": mobile,
                    "member_id": member.id if member else None,
                    "variables": variables,
                })
    except FileNotFoundError:
        return []
    return recipients


@router.post("/campaigns/csv", response_model=schemas_notifications.NotificationCampaign)
# Not @approval_gate.gated: UploadFile + BackgroundTasks (see notes elsewhere).
async def create_csv_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    campaign_name: str,
    template_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> Any:
    """Bulk send to an uploaded CSV of numbers (header: mobile, plus any
    {{variable}} columns) using an approved template."""
    template = db.query(NotificationTemplate).filter(
        NotificationTemplate.id == template_id,
        NotificationTemplate.is_deleted == False,
        NotificationTemplate.status == True,  # noqa: E712
    ).first()
    if not template:
        raise HTTPException(404, "Active template not found")

    import os
    from services.file_upload import ALLOWED_TYPES

    if file.content_type not in ("text/csv", "application/vnd.ms-excel", "text/plain"):
        raise HTTPException(400, f"File type '{file.content_type}' not allowed; upload a CSV")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, "CSV exceeds 5MB limit")

    folder = os.path.join(settings.UPLOAD_DIR, "notification_imports")
    os.makedirs(folder, exist_ok=True)
    filepath = os.path.join(folder, f"campaign_import_{secrets.token_hex(8)}.csv")
    with open(filepath, "wb") as fh:
        fh.write(contents)

    campaign = NotificationCampaign(
        campaign_name=campaign_name,
        template_id=template_id,
        source="CSV",
        status="PENDING",
        created_by=current_user.id,
    )
    db.add(campaign)
    db.flush()
    db.add(NotificationImportBatch(
        campaign_id=campaign.id,
        file_path=filepath,
        status="IMPORTED",
        created_by=current_user.id,
    ))
    db.commit()
    db.refresh(campaign)
    return campaign


@router.post("/send-individual")
# Not @approval_gate.gated: takes a BackgroundTasks param.
async def send_individual_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    member_id: int,
    template_id: int,
    variables: Optional[dict] = None,
    background_tasks: BackgroundTasks = None,
) -> Any:
    """Send a custom WhatsApp notification to a single member (template based).

    ``variables`` fills the template's {{placeholders}} on top of the member's
    standard ones (name, member_code, mobile, full_name_kn).
    """
    if background_tasks is None:
        background_tasks = BackgroundTasks()
    member = db.query(Member).filter(Member.id == member_id, Member.is_deleted == False).first()
    if not member or not member.mobile:
        raise HTTPException(status_code=404, detail="Member not found or has no mobile")

    template = db.query(NotificationTemplate).filter(
        NotificationTemplate.id == template_id,
        NotificationTemplate.is_deleted == False,
        NotificationTemplate.status == True,  # noqa: E712
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Active template not found")

    merged = {**_member_variables(member), **(variables or {})}
    content = render(template.content, merged)

    # Eager copies — the request's ORM objects are gone by the time the
    # background task runs.
    to_number = f"{member.mobile_country_code}{member.mobile}"
    recipient_number = member.mobile
    provider_template_id = template.provider_template_id
    acting_user_id = current_user.id

    async def send():
        from db.session import SessionLocal

        status, response = "FAILED", None
        try:
            response = await whatsapp_service.send_message(
                to=to_number, message=content, template_id=provider_template_id
            )
            status = "SENT"
        except Exception as exc:
            response = {"error": str(exc)}

        session = SessionLocal()
        try:
            session.add(NotificationMessage(
                member_id=member_id,
                recipient_number=recipient_number,
                message_content=content,
                delivery_status=status,
                provider_response=response,
                created_by=acting_user_id,
            ))
            session.commit()
        finally:
            session.close()

    background_tasks.add_task(send)
    return {"message": "Notification queued for sending", "rendered_content": content}


@router.post("/send-bulk")
# Not @approval_gate.gated: takes a BackgroundTasks param.
async def send_bulk_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    payload: schemas_notifications.BulkSendRequest,
    background_tasks: BackgroundTasks = None,
) -> Any:
    """Bulk WhatsApp to registered members — all, or filtered
    (district/taluk/gender/membership type/...). Personalised per member."""
    if background_tasks is None:
        background_tasks = BackgroundTasks()
    template = db.query(NotificationTemplate).filter(
        NotificationTemplate.id == payload.template_id,
        NotificationTemplate.is_deleted == False,
        NotificationTemplate.status == True,  # noqa: E712
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Active template not found")
    if payload.member_filters:
        unknown = set(payload.member_filters) - VALID_MEMBER_FILTERS
        if unknown:
            raise HTTPException(400, f"Unknown member filters: {', '.join(sorted(unknown))}")

    members = _resolve_member_recipients(db, payload.member_filters)
    numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]
    variables_by_number = {
        f"{m.mobile_country_code}{m.mobile}": _member_variables(m) for m in members
    }
    provider_template_id = template.provider_template_id
    raw_content = template.content
    acting_user_id = current_user.id

    async def bulk_send():
        from db.session import SessionLocal

        results = await whatsapp_service.send_bulk(numbers, raw_content, provider_template_id)
        session = SessionLocal()
        try:
            for result in results:
                rendered = render(raw_content, variables_by_number.get(result.get("to")))
                session.add(NotificationMessage(
                    recipient_number=(result.get("to") or "")[3:],
                    message_content=rendered,
                    delivery_status="SENT" if result.get("ok") else "FAILED",
                    provider_response=result.get("result") or result.get("error"),
                    created_by=acting_user_id,
                ))
            session.commit()
        finally:
            session.close()

    background_tasks.add_task(bulk_send)
    return {"message": f"Bulk notification queued for {len(numbers)} members"}


@router.get("/campaigns/{campaign_id}", response_model=schemas_notifications.NotificationCampaign)
def read_campaign(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), campaign_id: int) -> Any:
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id, NotificationCampaign.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c

@router.put("/campaigns/{campaign_id}", response_model=Union[schemas_notifications.NotificationCampaign, PendingApproval])
@approval_gate.gated("notifications", "UPDATE", "NotificationCampaign", "notifications.update", id_param="campaign_id")
def update_campaign(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.update")),
    campaign_id: int, campaign_in: schemas_notifications.NotificationCampaignUpdate,
) -> Any:
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id, NotificationCampaign.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    if c.status in ("QUEUED", "SENT"):
        raise HTTPException(400, f"Campaign is already {c.status.lower()} and can no longer be edited")
    data = campaign_in.model_dump(exclude_unset=True)
    if "template_id" in data and not db.query(NotificationTemplate).filter(
        NotificationTemplate.id == data["template_id"], NotificationTemplate.is_deleted == False).first():
        raise HTTPException(404, "Template not found")
    for k, v in data.items():
        setattr(c, k, v)
    c.updated_by = current_user.id
    db.commit(); db.refresh(c)
    return c

@router.delete("/campaigns/{campaign_id}")
@approval_gate.gated("notifications", "DELETE", "NotificationCampaign", "notifications.delete", id_param="campaign_id")
def delete_campaign(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.delete")),
    campaign_id: int,
) -> Any:
    c = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id, NotificationCampaign.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    if c.status == "QUEUED":
        raise HTTPException(400, "Campaign is being sent and cannot be deleted")
    c.is_deleted = True; c.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

@router.post("/campaigns/{campaign_id}/send")
# Not @approval_gate.gated: takes a BackgroundTasks param.
async def send_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    campaign_id: int,
    background_tasks: BackgroundTasks,
) -> Any:
    campaign = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status in ("QUEUED", "SENT"):
        raise HTTPException(400, f"Campaign is already {campaign.status.lower()}")
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == campaign.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if campaign.source == "CSV":
        entries = _resolve_csv_recipients(db, campaign.id)
        if not entries:
            raise HTTPException(400, "No valid recipients found in the imported CSV")
        recipients = [
            NotificationRecipient(
                campaign_id=campaign.id,
                member_id=e["member_id"],
                mobile=e["mobile"],
                variables=e["variables"],
                created_by=current_user.id,
            )
            for e in entries
        ]
        numbers = [f"+91{e['mobile']}" if not e["mobile"].startswith("+") else e["mobile"] for e in entries]
        variables_by_number = {
            (f"+91{e['mobile']}" if not e["mobile"].startswith("+") else e["mobile"]): {
                **(e["variables"] or {}),
                **({"name": _member_variables(m)["name"]} if e["member_id"] else {}),
            }
            for e in entries
        }
    else:
        members = _resolve_member_recipients(db, campaign.member_filters)
        recipients = [
            NotificationRecipient(
                campaign_id=campaign.id,
                member_id=member.id,
                mobile=member.mobile,
                variables=_member_variables(member),
                created_by=current_user.id,
            )
            for member in members
        ]
        numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]
        variables_by_number = {
            f"{m.mobile_country_code}{m.mobile}": _member_variables(m) for m in members
        }

    db.add_all(recipients)
    campaign.total_recipients = len(recipients)
    campaign.status = "QUEUED"
    campaign.updated_by = current_user.id
    db.commit()

    provider_template_id = template.provider_template_id
    raw_content = template.content

    async def campaign_send():
        results = await whatsapp_service.send_bulk(numbers, raw_content, provider_template_id)
        _finish_campaign(campaign_id, results)

    background_tasks.add_task(campaign_send)
    return {"message": f"Campaign queued for {len(recipients)} recipients"}


@router.post("/callbacks")
def notification_callback(
    *,
    request: Request,
    db: Session = Depends(deps.get_db),
    payload: schemas_notifications.NotificationCallback,
) -> Any:
    """Provider delivery-status callback.

    Authenticates with a shared secret in X-Callback-Secret — while
    WHATSAPP_CALLBACK_SECRET is unset, callbacks are rejected entirely.
    """
    if not settings.WHATSAPP_CALLBACK_SECRET:
        raise HTTPException(
            status_code=403,
            detail="Delivery callbacks are disabled (set WHATSAPP_CALLBACK_SECRET)",
        )
    provided = request.headers.get("X-Callback-Secret") or ""
    if not secrets.compare_digest(provided, settings.WHATSAPP_CALLBACK_SECRET):
        raise HTTPException(status_code=403, detail="Invalid callback secret")

    message = db.query(NotificationMessage).filter(NotificationMessage.id == payload.message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    message.delivery_status = payload.status_update
    log = NotificationDeliveryLog(
        message_id=payload.message_id,
        status_update=payload.status_update,
        updated_at_provider=payload.updated_at_provider,
    )
    db.add(log)
    db.commit()
    return {"message": "Delivery status updated"}


# ── Membership expiry reminders ─────────────────────────────

@router.post("/expiry-reminders")
# Not @approval_gate.gated: takes a BackgroundTasks param.
def send_expiry_reminders(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    days_ahead: int = 30,
    background_tasks: BackgroundTasks,
) -> Any:
    """Scan memberships expiring within `days_ahead` days and queue the
    MEMBERSHIP_EXPIRY WhatsApp template for each member (Mangalya-parity
    renewal reminders driven by member_memberships.expires_at).

    Members reminded within the last 7 days are skipped so repeated runs
    don't spam. Every send is logged to notification_messages.
    """
    from datetime import datetime, timedelta, timezone

    from models.members import MemberMembership

    template = (
        db.query(NotificationTemplate)
        .filter(
            NotificationTemplate.purpose == EXPIRY_PURPOSE,
            NotificationTemplate.status == True,  # noqa: E712
            NotificationTemplate.is_deleted == False,
        )
        .first()
    )
    if not template:
        raise HTTPException(400, f"No active template with purpose={EXPIRY_PURPOSE}")

    now = datetime.now(timezone.utc)
    deadline = now + timedelta(days=days_ahead)

    def _aware(dt):
        """SQLite returns naive datetimes; assume they are UTC."""
        return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt

    expiring = (
        db.query(MemberMembership, Member)
        .join(Member, Member.id == MemberMembership.member_id)
        .filter(
            MemberMembership.is_deleted == False,
            MemberMembership.status == "ACTIVE",
            MemberMembership.expires_at.isnot(None),
            MemberMembership.expires_at >= now,
            MemberMembership.expires_at <= deadline,
            Member.is_deleted == False,
            Member.member_status == "ACTIVE",
            Member.mobile.isnot(None),
        )
        .all()
    )

    # Skip members already reminded in the last 7 days (message rows carry
    # the campaign id; only this reminder flow creates expiry campaigns).
    cutoff = now - timedelta(days=7)
    reminder_campaign_ids = [
        row.id
        for row in db.query(NotificationCampaign.id).filter(
            NotificationCampaign.is_deleted == False,
            NotificationCampaign.target_audience.like("EXPIRY|%"),
            NotificationCampaign.created_at >= cutoff,
        )
    ]
    reminded_member_ids = {
        row.member_id
        for row in db.query(NotificationMessage.member_id).filter(
            NotificationMessage.is_deleted == False,
            NotificationMessage.campaign_id.in_(reminder_campaign_ids),
        )
        if row.member_id is not None
    } if reminder_campaign_ids else set()

    recipients = []
    for membership, member in expiring:
        expires = _aware(membership.expires_at)
        if member.id in reminded_member_ids:
            continue
        recipients.append((membership, member, expires))
    if not recipients:
        return {"queued": 0, "template_id": template.id, "days_ahead": days_ahead}

    campaign = NotificationCampaign(
        campaign_name=f"Expiry reminders {now:%Y-%m-%d %H:%M}",
        template_id=template.id,
        target_audience=f"EXPIRY|{days_ahead}d",
        source="MEMBERS",
        status="PENDING",
        total_recipients=len(recipients),
        created_by=current_user.id,
    )
    db.add(campaign)
    db.flush()

    jobs = []
    for membership, member, expires in recipients:
        variables = {
            **_member_variables(member),
            "expiry_date": expires.strftime("%d-%m-%Y") if expires else "",
            "days_left": str(max((expires - now).days, 0)) if expires else "",
        }
        content = render(template.content, variables)
        to_number = f"{member.mobile_country_code}{member.mobile}"
        db.add(NotificationRecipient(
            campaign_id=campaign.id,
            member_id=member.id,
            mobile=to_number,
            variables=variables,
            created_by=current_user.id,
        ))
        jobs.append((member.id, to_number, content))
    db.commit()

    campaign_id = campaign.id
    provider_template_id = template.provider_template_id

    async def _send_all():
        from db.session import SessionLocal

        results = []
        for member_id, to_number, content in jobs:
            status, response = "FAILED", None
            try:
                from services.whatsapp import whatsapp_service as svc
                response = await svc.send_message(
                    to=to_number, message=content, template_id=provider_template_id
                )
                status = "SENT"
            except Exception as exc:
                response = {"error": str(exc)}
            results.append({"ok": status == "SENT", "member_id": member_id,
                            "to": to_number, "content": content, "response": response})

        session = SessionLocal()
        try:
            for r in results:
                session.add(NotificationMessage(
                    campaign_id=campaign_id,
                    member_id=r["member_id"],
                    recipient_number=r["to"],
                    message_content=r["content"],
                    delivery_status="SENT" if r["ok"] else "FAILED",
                    provider_response=r["response"],
                    created_by=current_user.id,
                ))
            session.commit()
            _finish_campaign(campaign_id, results)
        finally:
            session.close()

    background_tasks.add_task(_send_all)
    return {
        "queued": len(recipients),
        "template_id": template.id,
        "campaign_id": campaign_id,
        "days_ahead": days_ahead,
    }


# ── In-app notification inbox ───────────────────────────────

@router.get("/inbox")
def read_inbox(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 20,
    unread_only: bool = False,
) -> Any:
    """Signed-in user's in-app notifications: personal rows plus broadcasts
    (user_id IS NULL). Read-state is tracked per user without fan-out."""
    from models.inbox import AppNotification, AppNotificationRead

    q = (
        db.query(AppNotification)
        .outerjoin(AppNotificationRead, (AppNotificationRead.notification_id == AppNotification.id)
                   & (AppNotificationRead.user_id == current_user.id)
                   & (AppNotificationRead.is_deleted == False))
        .filter(
            AppNotification.is_deleted == False,
            sa_or(
                AppNotification.user_id == current_user.id,
                AppNotification.user_id.is_(None),
            ),
        )
    )
    if unread_only:
        q = q.filter(AppNotificationRead.id.is_(None))
    q = q.order_by(AppNotification.id.desc())
    return paginate(q, page, limit)


@router.get("/inbox/unread-count")
def read_inbox_unread_count(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    from models.inbox import AppNotification, AppNotificationRead

    count = (
        db.query(AppNotification)
        .outerjoin(AppNotificationRead, (AppNotificationRead.notification_id == AppNotification.id)
                   & (AppNotificationRead.user_id == current_user.id)
                   & (AppNotificationRead.is_deleted == False))
        .filter(
            AppNotification.is_deleted == False,
            AppNotificationRead.id.is_(None),
            sa_or(
                AppNotification.user_id == current_user.id,
                AppNotification.user_id.is_(None),
            ),
        )
        .count()
    )
    return {"unread": count}


@router.post("/inbox/{notification_id}/read")
def mark_inbox_read(
    notification_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Mark one inbox notification as read (idempotent)."""
    from datetime import datetime, timezone

    from models.inbox import AppNotification, AppNotificationRead

    notification = db.query(AppNotification).filter(
        AppNotification.id == notification_id,
        AppNotification.is_deleted == False,
        sa_or(
            AppNotification.user_id == current_user.id,
            AppNotification.user_id.is_(None),
        ),
    ).first()
    if not notification:
        raise HTTPException(404, "Notification not found")

    existing = db.query(AppNotificationRead).filter(
        AppNotificationRead.notification_id == notification_id,
        AppNotificationRead.user_id == current_user.id,
        AppNotificationRead.is_deleted == False,
    ).first()
    if not existing:
        db.add(AppNotificationRead(
            notification_id=notification_id,
            user_id=current_user.id,
            read_at=datetime.now(timezone.utc),
            created_by=current_user.id,
        ))
        db.commit()
    return {"id": notification_id, "read": True}


@router.post("/inbox/broadcast")
@approval_gate.gated("notifications", "CREATE", "AppNotificationBroadcast", "notifications.create")
def broadcast_inbox(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.create")),
    payload: schemas_notifications.InboxBroadcastCreate,
) -> Any:
    """Staff broadcast: a single row visible to every user (no fan-out)."""
    from datetime import datetime, timezone

    from models.inbox import AppNotification

    notification = AppNotification(
        title=payload.title,
        body=payload.body,
        source=payload.source or "MANUAL",
        data=payload.data,
        sent_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    from core.pagination import _to_plain
    return _to_plain(notification, set())


# ── Push device tokens ──────────────────────────────────────

@router.post("/devices")
def register_device(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    payload: schemas_notifications.DeviceTokenCreate,
) -> Any:
    """Register (or refresh) a push token for the signed-in user — the
    mobile app calls this after login. Idempotent per user+token."""
    from datetime import datetime, timezone

    from models.inbox import UserDeviceToken

    row = db.query(UserDeviceToken).filter(
        UserDeviceToken.user_id == current_user.id,
        UserDeviceToken.device_token == payload.device_token,
        UserDeviceToken.is_deleted == False,
    ).first()
    if row:
        row.last_used_at = datetime.now(timezone.utc)
        row.device_name = payload.device_name or row.device_name
    else:
        row = UserDeviceToken(
            user_id=current_user.id,
            device_token=payload.device_token,
            platform=payload.platform,
            device_name=payload.device_name,
            last_used_at=datetime.now(timezone.utc),
            created_by=current_user.id,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "registered": True}


@router.delete("/devices/{token_id}")
def deregister_device(
    token_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    from models.inbox import UserDeviceToken

    row = db.query(UserDeviceToken).filter(
        UserDeviceToken.id == token_id,
        UserDeviceToken.user_id == current_user.id,
        UserDeviceToken.is_deleted == False,
    ).first()
    if not row:
        raise HTTPException(404, "Device not found")
    row.is_deleted = True
    db.commit()
    return {"message": "Device removed"}
