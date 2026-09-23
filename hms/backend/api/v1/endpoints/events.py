from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.members import Member
from schemas import events as schemas_events
from crud import events as crud_events
from core.pagination import paginate
from services.file_upload import save_upload
from services.whatsapp import whatsapp_service
from services.template_renderer import render
from models.events import Event, EventParticipant, EventAttachment, EventMemberLink

router = APIRouter()


def _event_variables(event: Event) -> dict:
    """Standard {{placeholders}} for event notifications."""
    return {
        "event_title": event.title or "",
        "event_date": event.event_date.isoformat() if event.event_date else "",
        "location": event.location or "",
    }


@router.get("/")
def read_events(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1, limit: int = 20,
    upcoming_only: bool = False,
) -> Any:
    q = db.query(Event).filter(Event.is_deleted == False)
    if upcoming_only:
        from datetime import date
        q = q.filter(Event.event_date >= date.today())
    return paginate(q.order_by(Event.event_date.desc()), page, limit)


@router.get("/upcoming")
def read_upcoming_events(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    limit: int = 10,
) -> Any:
    """Next events (for dashboards)."""
    from datetime import date
    events = (
        db.query(Event)
        .filter(Event.is_deleted == False, Event.event_date >= date.today())
        .order_by(Event.event_date)
        .limit(min(limit, 50))
        .all()
    )
    return {"total": len(events), "data": [
        {
            "id": e.id, "title": e.title, "event_date": e.event_date,
            "location": e.location, "invitation_file_path": e.invitation_file_path,
        } for e in events
    ]}


@router.post("/", response_model=schemas_events.Event)
def create_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), event_in: schemas_events.EventCreate) -> Any:
    return crud_events.event.create(db=db, obj_in=event_in, created_by=current_user.id)


@router.get("/{id}", response_model=schemas_events.Event)
def read_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_events.event.get(db, id)
    if not obj: raise HTTPException(404, "Event not found")
    return obj


@router.get("/{id}/detail")
def read_event_detail(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    id: int,
) -> Any:
    """Event with its guests/honoured persons, member links and attachments."""
    event = crud_events.event.get(db, id)
    if not event:
        raise HTTPException(404, "Event not found")

    participants = db.query(EventParticipant).filter(
        EventParticipant.event_id == id, EventParticipant.is_deleted == False
    ).order_by(EventParticipant.id).all()

    # Resolve member names for linked participants.
    member_ids = {p.member_id for p in participants if p.member_id}
    member_names = {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            member_names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)

    links = db.query(EventMemberLink).filter(
        EventMemberLink.event_id == id, EventMemberLink.is_deleted == False
    ).all()
    attachments = db.query(EventAttachment).filter(
        EventAttachment.event_id == id, EventAttachment.is_deleted == False
    ).all()

    return {
        "event": {
            "id": event.id,
            "title": event.title,
            "description": event.description,
            "event_date": event.event_date,
            "location": event.location,
            "invitation_file_path": event.invitation_file_path,
        },
        "guests": [
            {
                "id": p.id,
                "name": p.participant_name,
                "role": p.participant_role,
                "member_id": p.member_id,
                "member_name": member_names.get(p.member_id),
            }
            for p in participants if p.participant_type == "GUEST"
        ],
        "honoured": [
            {
                "id": p.id,
                "name": p.participant_name,
                "role": p.participant_role,
                "member_id": p.member_id,
                "member_name": member_names.get(p.member_id),
            }
            for p in participants if p.participant_type == "HONOURED"
        ],
        "member_links": [
            {"id": l.id, "member_id": l.member_id, "role": l.role} for l in links
        ],
        "attachments": [
            {
                "id": a.id,
                "file_path": a.file_path,
                "original_filename": a.original_filename,
            }
            for a in attachments
        ],
    }


@router.put("/{id}", response_model=schemas_events.Event)
def update_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), id: int, event_in: schemas_events.EventUpdate) -> Any:
    obj = crud_events.event.get(db, id)
    if not obj: raise HTTPException(404, "Event not found")
    return crud_events.event.update(db, db_obj=obj, obj_in=event_in, updated_by=current_user.id)


@router.delete("/{id}", response_model=schemas_events.Event)
def delete_event(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("events.write")), id: int) -> Any:
    return crud_events.event.remove(db, id=id, deleted_by=current_user.id)


# ─────────────── invitation copy upload ───────────────

@router.post("/{id}/invitation")
async def upload_invitation(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    id: int,
    file: UploadFile = File(...),
) -> Any:
    """Upload the invitation copy; it becomes the event's primary invitation."""
    event = crud_events.event.get(db, id)
    if not event:
        raise HTTPException(404, "Event not found")
    meta = await save_upload(file, subfolder="event_invitations")
    event.invitation_file_path = meta["file_path"]
    event.updated_by = current_user.id

    db.add(EventAttachment(
        event_id=id,
        file_path=meta["file_path"],
        original_filename=meta["original_filename"],
        mime_type=meta["mime_type"],
        created_by=current_user.id,
    ))
    db.commit()
    db.refresh(event)
    return {
        "invitation_file_path": event.invitation_file_path,
        "original_filename": meta["original_filename"],
    }


@router.post("/{event_id}/attachment")
async def upload_event_attachment(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int, file: UploadFile = File(...)
) -> Any:
    """Additional event documents (agenda, photos, …)."""
    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    meta = await save_upload(file, subfolder="event_attachments")
    att = EventAttachment(
        event_id=event_id, file_path=meta["file_path"],
        original_filename=meta["original_filename"],
        mime_type=meta["mime_type"], created_by=current_user.id
    )
    db.add(att)
    db.commit()
    return {"file_path": meta["file_path"]}


# ─────────────── guests & honoured persons ───────────────

@router.get("/{event_id}/participants")
def read_participants(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    event_id: int,
    participant_type: Optional[str] = None,
) -> Any:
    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    q = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id, EventParticipant.is_deleted == False
    )
    if participant_type:
        ptype = participant_type.upper()
        if ptype not in ("GUEST", "HONOURED"):
            raise HTTPException(400, "participant_type must be GUEST or HONOURED")
        q = q.filter(EventParticipant.participant_type == ptype)
    rows = q.order_by(EventParticipant.id).all()

    member_ids = {p.member_id for p in rows if p.member_id}
    member_names = {}
    if member_ids:
        for m in db.query(Member).filter(Member.id.in_(member_ids)).all():
            member_names[m.id] = " ".join(p for p in (m.first_name_en, m.last_name_en) if p)

    return {
        "total": len(rows),
        "data": [
            {
                "id": p.id,
                "name": p.participant_name,
                "role": p.participant_role,
                "participant_type": p.participant_type,
                "member_id": p.member_id,
                "member_name": member_names.get(p.member_id),
            }
            for p in rows
        ],
    }


@router.post("/{event_id}/participants", response_model=schemas_events.EventParticipant, status_code=201)
def add_participant(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int,
    participant_in: schemas_events.EventParticipantCreate,
) -> Any:
    """Add a guest or honoured person. When member_id is given the person is
    a Havyaka member and the event shows up on their profile screen."""
    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if participant_in.member_id:
        member = db.query(Member).filter(
            Member.id == participant_in.member_id, Member.is_deleted == False
        ).first()
        if not member:
            raise HTTPException(400, f"Member {participant_in.member_id} not found")
    p = EventParticipant(
        event_id=event_id,
        participant_name=participant_in.participant_name,
        participant_role=participant_in.participant_role,
        participant_type=participant_in.participant_type.upper(),
        member_id=participant_in.member_id,
        created_by=current_user.id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.put("/{event_id}/participants/{participant_id}", response_model=schemas_events.EventParticipant)
def update_participant(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int,
    participant_id: int,
    participant_in: schemas_events.EventParticipantUpdate,
) -> Any:
    """Correct a participant's name/role/type or (re)link them to a member."""
    p = db.query(EventParticipant).filter(
        EventParticipant.id == participant_id,
        EventParticipant.event_id == event_id,
        EventParticipant.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Participant not found")
    data = participant_in.model_dump(exclude_unset=True)
    if data.get("participant_type"):
        data["participant_type"] = data["participant_type"].upper()
        if data["participant_type"] not in ("GUEST", "HONOURED"):
            raise HTTPException(400, "participant_type must be GUEST or HONOURED")
    if data.get("member_id"):
        member = db.query(Member).filter(
            Member.id == data["member_id"], Member.is_deleted == False
        ).first()
        if not member:
            raise HTTPException(400, f"Member {data['member_id']} not found")
    for field, value in data.items():
        setattr(p, field, value)
    p.updated_by = current_user.id
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{event_id}/participants/{participant_id}", response_model=schemas_events.EventParticipant)
def remove_participant(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int,
    participant_id: int,
) -> Any:
    p = db.query(EventParticipant).filter(
        EventParticipant.id == participant_id,
        EventParticipant.event_id == event_id,
        EventParticipant.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Participant not found")
    p.is_deleted = True
    p.deleted_by = current_user.id
    db.commit()
    db.refresh(p)
    return p


@router.post("/{event_id}/links")
def link_member(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("events.write")),
    event_id: int,
    member_id: int,
    role: Optional[str] = None,
) -> Any:
    """Link a member to the event (organiser, volunteer, attendee…)."""
    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    member = db.query(Member).filter(Member.id == member_id, Member.is_deleted == False).first()
    if not member:
        raise HTTPException(400, f"Member {member_id} not found")
    existing = db.query(EventMemberLink).filter(
        EventMemberLink.event_id == event_id,
        EventMemberLink.member_id == member_id,
        EventMemberLink.is_deleted == False,
    ).first()
    if existing:
        existing.role = role or existing.role
        existing.updated_by = current_user.id
        db.commit()
        return {"message": "Member link updated", "link_id": existing.id}
    link = EventMemberLink(
        event_id=event_id, member_id=member_id, role=role, created_by=current_user.id
    )
    db.add(link)
    db.commit()
    return {"message": "Member linked to event", "link_id": link.id}


# ─────────────── event notifications ───────────────

@router.post("/{event_id}/notify")
async def notify_event_members(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("notifications.write")),
    event_id: int,
    background_tasks: BackgroundTasks,
    template_id: Optional[int] = None,
    message: Optional[str] = None,
) -> Any:
    """WhatsApp everyone linked to the event (spec: 'this event can be used to
    send the notification'). Template based when template_id is given —
    {{event_title}}, {{event_date}}, {{location}} are filled automatically.

    Recipients: event_member_links plus member-linked participants.
    """
    from models.notifications import NotificationTemplate, NotificationMessage

    event = crud_events.event.get(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    provider_template_id = None
    if template_id:
        template = db.query(NotificationTemplate).filter(
            NotificationTemplate.id == template_id,
            NotificationTemplate.is_deleted == False,
            NotificationTemplate.status == True,  # noqa: E712
        ).first()
        if not template:
            raise HTTPException(404, "Active template not found")
        message = message or template.content
        provider_template_id = template.provider_template_id
    if not message:
        raise HTTPException(400, "Provide a message or a template_id")

    event_vars = _event_variables(event)
    rendered = render(message, event_vars)

    linked = {
        row[0]
        for row in db.query(EventMemberLink.member_id).filter(
            EventMemberLink.event_id == event_id,
            EventMemberLink.is_deleted == False,
        ).all()
    }
    linked |= {
        row[0]
        for row in db.query(EventParticipant.member_id).filter(
            EventParticipant.event_id == event_id,
            EventParticipant.member_id != None,  # noqa: E711
            EventParticipant.is_deleted == False,
        ).all()
    }
    if not linked:
        return {"message": "No members are linked to this event", "queued": 0}

    members = db.query(Member).filter(
        Member.id.in_(linked),
        Member.mobile != None,  # noqa: E711
        Member.is_deleted == False,
    ).all()
    numbers = [f"{m.mobile_country_code}{m.mobile}" for m in members]
    recipient_numbers = [m.mobile for m in members]
    member_ids = [m.id for m in members]

    async def _send():
        from db.session import SessionLocal

        results = await whatsapp_service.send_bulk(numbers, rendered, provider_template_id)
        session = SessionLocal()
        try:
            for member_id, number, result in zip(member_ids, recipient_numbers, results):
                session.add(NotificationMessage(
                    member_id=member_id,
                    recipient_number=number,
                    message_content=rendered,
                    delivery_status="SENT" if result.get("ok") else "FAILED",
                    provider_response=result.get("result") or result.get("error"),
                    created_by=current_user.id,
                ))
            session.commit()
        finally:
            session.close()

    background_tasks.add_task(_send)
    return {
        "message": f"Notification queued for {len(numbers)} member(s)",
        "queued": len(numbers),
        "rendered_content": rendered,
    }
