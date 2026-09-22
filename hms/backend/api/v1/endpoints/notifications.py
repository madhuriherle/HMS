from typing import Any, List, Optional
import secrets

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy.orm import Session
from api import deps
from core.config import settings
from models.users import User
from models.notifications import (
    NotificationCampaign,
    NotificationDeliveryLog,
    NotificationMessage,
    NotificationRecipient,
    NotificationTemplate,
)
from services.whatsapp import whatsapp_service
from core.pagination import paginate
from schemas import notifications as schemas_notifications

router = APIRouter()


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
def read_templates(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 50) -> Any:
    q = db.query(NotificationTemplate).filter(NotificationTemplate.is_deleted == False)
    return paginate(q, page, limit)

@router.post("/templates", response_model=schemas_notifications.NotificationTemplate)
def create_template(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    template_in: schemas_notifications.NotificationTemplateCreate,
) -> Any:
    from crud import notifications as crud_notif
    return crud_notif.template.create(db=db, obj_in=template_in, created_by=current_user.id)

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

@router.post("/campaigns", response_model=schemas_notifications.NotificationCampaign)
def create_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    campaign_in: schemas_notifications.NotificationCampaignCreate,
) -> Any:
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == campaign_in.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    campaign = NotificationCampaign(**campaign_in.model_dump(), created_by=current_user.id)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign

@router.post("/send-individual")
async def send_individual_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    member_id: int,
    template_id: int,
    background_tasks: BackgroundTasks,
) -> Any:
    """Send a WhatsApp notification to a single member."""
    from models.members import Member
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member or not member.mobile:
        raise HTTPException(status_code=404, detail="Member not found or has no mobile")

    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Eager copies — the request's ORM objects are gone by the time the
    # background task runs.
    to_number = f"{member.mobile_country_code}{member.mobile}"
    recipient_number = member.mobile
    content = template.content
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
    return {"message": "Notification queued for sending"}

@router.post("/send-bulk")
async def send_bulk_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    template_id: int,
    background_tasks: BackgroundTasks,
) -> Any:
    """Send WhatsApp notification to ALL active members."""
    from models.members import Member
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    members = db.query(Member).filter(
        Member.mobile != None,
        Member.member_status == "ACTIVE",
        Member.is_deleted == False
    ).all()
    # Plain strings — safe to use after the request session closes.
    numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]
    content = template.content
    provider_template_id = template.provider_template_id

    async def bulk_send():
        await whatsapp_service.send_bulk(numbers, content, provider_template_id)

    background_tasks.add_task(bulk_send)
    return {"message": f"Bulk notification queued for {len(numbers)} members"}

@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    campaign_id: int,
    background_tasks: BackgroundTasks,
) -> Any:
    from models.members import Member

    campaign = db.query(NotificationCampaign).filter(NotificationCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    template = db.query(NotificationTemplate).filter(NotificationTemplate.id == campaign.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    members = db.query(Member).filter(
        Member.mobile != None,
        Member.member_status == "ACTIVE",
        Member.is_deleted == False,
    ).all()
    recipients = [
        NotificationRecipient(
            campaign_id=campaign.id,
            member_id=member.id,
            mobile=member.mobile,
            created_by=current_user.id,
        )
        for member in members
    ]
    db.add_all(recipients)
    campaign.status = "QUEUED"
    campaign.updated_by = current_user.id
    db.commit()

    numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]
    content = template.content
    provider_template_id = template.provider_template_id

    async def campaign_send():
        results = await whatsapp_service.send_bulk(numbers, content, provider_template_id)
        _finish_campaign(campaign_id, results)

    background_tasks.add_task(campaign_send)
    return {"message": f"Campaign queued for {len(numbers)} members"}

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
