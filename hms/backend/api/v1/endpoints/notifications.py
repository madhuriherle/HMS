from typing import Any, List, Optional
import secrets

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, UploadFile, File
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

router = APIRouter()

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

@router.post("/templates", response_model=schemas_notifications.NotificationTemplate)
def create_template(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    template_in: schemas_notifications.NotificationTemplateCreate,
) -> Any:
    from crud import notifications as crud_notif
    return crud_notif.template.create(db=db, obj_in=template_in, created_by=current_user.id)

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
async def create_csv_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
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
async def send_individual_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
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
async def send_bulk_notification(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
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


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
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
