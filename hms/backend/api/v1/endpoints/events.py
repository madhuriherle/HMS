from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from schemas import events as schemas_events
from crud import events as crud_events
from core.pagination import paginate
from services.file_upload import save_upload
from services.whatsapp import whatsapp_service
from models.events import Event, EventParticipant, EventAttachment, EventMemberLink

router = APIRouter()

@router.get("/")
def read_events(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20
) -> Any:
    return paginate(db.query(Event).filter(Event.is_deleted == False), page, limit)

@router.post("/", response_model=schemas_events.Event)
def create_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), event_in: schemas_events.EventCreate) -> Any:
    return crud_events.event.create(db=db, obj_in=event_in, created_by=current_user.id)

@router.get("/{id}", response_model=schemas_events.Event)
def read_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_events.event.get(db, id)
    if not obj: raise HTTPException(404, "Event not found")
    return obj

@router.put("/{id}", response_model=schemas_events.Event)
def update_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), id: int, event_in: schemas_events.EventUpdate) -> Any:
    obj = crud_events.event.get(db, id)
    if not obj: raise HTTPException(404, "Event not found")
    return crud_events.event.update(db, db_obj=obj, obj_in=event_in, updated_by=current_user.id)

@router.delete("/{id}", response_model=schemas_events.Event)
def delete_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), id: int) -> Any:
    return crud_events.event.remove(db, id=id, deleted_by=current_user.id)

@router.post("/{event_id}/attachment")
async def upload_event_attachment(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int, file: UploadFile = File(...)
) -> Any:
    meta = await save_upload(file, subfolder="event_attachments")
    att = EventAttachment(
        event_id=event_id, file_path=meta["file_path"],
        original_filename=meta["original_filename"],
        mime_type=meta["mime_type"], created_by=current_user.id
    )
    db.add(att)
    db.commit()
    return {"file_path": meta["file_path"]}

@router.post("/{event_id}/participants")
def add_participant(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int, participant_name: str,
    participant_role: str = None, member_id: int = None
) -> Any:
    p = EventParticipant(
        event_id=event_id, participant_name=participant_name,
        participant_role=participant_role, member_id=member_id,
        created_by=current_user.id
    )
    db.add(p)
    db.commit()
    return {"message": "Participant added"}

@router.post("/{event_id}/notify")
def notify_event_members(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    event_id: int,
    background_tasks: BackgroundTasks,
    message: Optional[str] = None,
    template_id: Optional[int] = None,
) -> Any:
    """WhatsApp everyone linked to the event (spec: 'this event can be used to
    send the notification'). Members come from event_member_links and event
    participants that are linked to a member."""
    from models.members import Member
    from models.notifications import NotificationTemplate

    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    content = message
    provider_template_id = None
    if template_id:
        template = db.query(NotificationTemplate).filter(
            NotificationTemplate.id == template_id,
            NotificationTemplate.is_deleted == False,
        ).first()
        if not template:
            raise HTTPException(404, "Template not found")
        content = content or template.content
        provider_template_id = template.provider_template_id
    if not content:
        raise HTTPException(400, "Provide a message or a template_id")

    linked = {
        row[0]
        for row in db.query(EventMemberLink.member_id).filter(
            EventMemberLink.event_id == event_id
        ).all()
    }
    linked |= {
        row[0]
        for row in db.query(EventParticipant.member_id).filter(
            EventParticipant.event_id == event_id,
            EventParticipant.member_id != None,
        ).all()
    }
    if not linked:
        return {"message": "No members are linked to this event", "queued": 0}

    members = db.query(Member).filter(
        Member.id.in_(linked),
        Member.mobile != None,
        Member.is_deleted == False,
    ).all()
    # Plain strings — safe to use after the request session closes.
    numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]

    async def _send():
        await whatsapp_service.send_bulk(numbers, content, provider_template_id)

    background_tasks.add_task(_send)
    return {
        "message": f"Notification queued for {len(numbers)} member(s)",
        "queued": len(numbers),
    }
