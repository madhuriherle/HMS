"""Recycle Bin: list, restore and permanently delete soft-deleted records.

Only record types listed in ``ENTITIES`` appear. A row is "in the bin" while
``is_deleted`` is true; restoring just clears the flag, so a restore that would
collide with a record created since (same code / number) is refused row by row.
"""
from dataclasses import dataclass
import logging
import re
from typing import Callable, Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from models.engagements import Affiliation, Associate, PressMedia
from models.events import Event
from models.masters import Bank, District, MembershipType, MembershipTypePrice, Particular, PostalCode, State, Taluk
from models.members import Member
from models.notifications import NotificationTemplate
from models.receipts import (
    PaymentTransaction, Receipt, ReceiptAllocation, ReceiptCancellation, ReceiptItem, RefundTransaction,
)
from models.users import User


def _join(*parts) -> str:
    return " ".join(str(p).strip() for p in parts if p and str(p).strip())


@dataclass(frozen=True)
class Entity:
    key: str
    label: str
    model: type
    name: Callable[[object], str]
    search_cols: tuple  # columns the search box looks in


ENTITIES = {
    e.key: e
    for e in (
        Entity("member", "Member", Member,
               lambda r: r.display_name or (r.member_code or f"Member {r.id}"),
               (Member.full_name_en, Member.first_name_en, Member.last_name_en, Member.member_code)),
        Entity("receipt", "Receipt", Receipt,
               lambda r: _join(f"Receipt {r.receipt_number}", "-", r.payer_name) if r.payer_name else f"Receipt {r.receipt_number}",
               (Receipt.receipt_number, Receipt.payer_name)),
        Entity("particular", "Particular", Particular, lambda r: r.name_en or f"Particular {r.id}", (Particular.name_en, Particular.code)),
        Entity("membership_type", "Membership Type", MembershipType, lambda r: r.name_en or f"Type {r.id}",
               (MembershipType.name_en, MembershipType.code)),
        Entity("bank", "Bank", Bank, lambda r: _join(r.name_en, r.branch_name) or f"Bank {r.id}", (Bank.name_en, Bank.branch_name)),
        Entity("user", "User", User, lambda r: r.name or r.username or f"User {r.id}", (User.name, User.username)),
        Entity("event", "Event", Event, lambda r: r.title or f"Event {r.id}", (Event.title,)),
        Entity("affiliation", "Affiliation", Affiliation, lambda r: r.group_name or f"Affiliation {r.id}", (Affiliation.group_name,)),
        Entity("associate", "Associate", Associate, lambda r: r.name or f"Associate {r.id}", (Associate.name, Associate.associate_number)),
        Entity("press_media", "Press & Media", PressMedia,
               lambda r: r.organization_name or r.reporter_name or f"Press {r.id}", (PressMedia.organization_name, PressMedia.reporter_name)),
        Entity("template", "Notification Template", NotificationTemplate,
               lambda r: r.template_name or f"Template {r.id}", (NotificationTemplate.template_name,)),
        Entity("state", "State", State, lambda r: r.name_en or f"State {r.id}", (State.name_en,)),
        Entity("district", "District", District, lambda r: r.name_en or f"District {r.id}", (District.name_en,)),
        Entity("postal_code", "PIN Code", PostalCode,
               lambda r: _join(r.pincode, r.post_office_name) or f"PIN {r.id}", (PostalCode.pincode, PostalCode.post_office_name)),
        Entity("taluk", "Taluk", Taluk, lambda r: r.name_en or f"Taluk {r.id}", (Taluk.name_en,)),
    )
}

PER_TYPE_LIMIT = 2000
logger = logging.getLogger("hms.recycle_bin")


def _why_not_deleted(exc: Exception) -> str:
    """Say what blocks the delete, from the database's own message."""
    text = str(getattr(exc, "orig", exc))
    tables = re.findall(r'on table "?(\w+)"?', text)  # Postgres names the parent first, then the table that still points at it
    if isinstance(exc, IntegrityError) and tables:
        return f"Still used by records in '{tables[-1].replace('_', ' ')}'. Delete or restore those first."
    if isinstance(exc, IntegrityError):
        return "Still used by other records, so it cannot be deleted permanently."
    return f"Could not be deleted: {text.strip().splitlines()[0][:160] if text.strip() else type(exc).__name__}"


def _deleted(model):
    return model.is_deleted == True  # noqa: E712


def _hidden(db: Session, viewer) -> set:
    """Accounts above the viewer: a deleted Super Admin never shows in anyone else's bin, and what such an
    account deleted is shown as done by the system."""
    if viewer is None:
        return set()
    from api import deps
    return deps.stronger_user_ids(db, viewer)


def _bin_query(db: Session, e: Entity, hidden: set):
    q = db.query(e.model).filter(_deleted(e.model))
    if e.key == "user" and hidden:
        q = q.filter(User.id.notin_(hidden))
    return q


def counts(db: Session, viewer=None) -> list:
    hidden = _hidden(db, viewer)
    out = []
    for e in ENTITIES.values():
        out.append({"value": e.key, "label": e.label, "count": _bin_query(db, e, hidden).count()})
    return out


def listing(db: Session, search: str = "", entity: str = "", page: int = 1, limit: int = 25, viewer=None) -> dict:
    hidden = _hidden(db, viewer)
    users = {}
    rows = []
    for e in ENTITIES.values():
        if entity and e.key != entity:
            continue
        q = _bin_query(db, e, hidden)
        if search:
            like = f"%{search.strip()}%"
            q = q.filter(or_(*[c.ilike(like) for c in e.search_cols]))
        for r in q.order_by(e.model.deleted_at.desc().nullslast(), e.model.id.desc()).limit(PER_TYPE_LIMIT).all():
            rows.append((e, r))
    rows.sort(key=lambda t: t[1].deleted_at.timestamp() if t[1].deleted_at else 0, reverse=True)

    total = len(rows)
    page = max(page, 1)
    window = rows[(page - 1) * limit: page * limit]
    ids = {r.deleted_by for _, r in window if r.deleted_by}
    if ids:
        users = {u.id: ("System" if u.id in hidden else (u.name or u.username)) for u in db.query(User).filter(User.id.in_(ids)).all()}
    data = [
        {
            "key": f"{e.key}:{r.id}",
            "entity": e.key,
            "entity_id": r.id,
            "name": e.name(r),
            "type": e.label,
            "deleted_at": r.deleted_at,
            "deleted_by": users.get(r.deleted_by),
        }
        for e, r in window
    ]
    return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, -(-total // limit))}


def _get(db: Session, entity: str, entity_id: int, hidden: set = frozenset()):
    e = ENTITIES.get(entity)
    if not e:
        return None, None
    row = _bin_query(db, e, set(hidden)).filter(e.model.id == entity_id).first()
    return e, row


def restore(db: Session, user_id: int, items: list, viewer=None) -> dict:
    done, failed = [], []
    hidden = _hidden(db, viewer)
    for it in items:
        e, row = _get(db, it["entity"], it["id"], hidden)
        if not row:
            failed.append({"key": f"{it['entity']}:{it['id']}", "error": "Not in the recycle bin any more."})
            continue
        label = e.name(row)
        try:
            with db.begin_nested():
                row.is_deleted = False
                row.deleted_at = None
                row.deleted_by = None
                row.updated_by = user_id
                if isinstance(row, Receipt):
                    db.flush()
                    from services import receipt_status
                    receipt_status.refresh(db, row)
                db.flush()
            done.append(label)
        except IntegrityError:
            failed.append({"key": f"{it['entity']}:{it['id']}", "name": label,
                           "error": "Another active record already uses the same code or number. Rename or delete that one first."})
    db.commit()
    return {"restored": len(done), "failed": failed}


def _purge_row(db: Session, e: Entity, row) -> None:
    if isinstance(row, Member):
        from api.v1.endpoints.approvals import _purge_member
        _purge_member(db, row.id)
        return
    if isinstance(row, Receipt):
        for m in (ReceiptItem, ReceiptAllocation, PaymentTransaction, ReceiptCancellation, RefundTransaction):
            db.query(m).filter(m.receipt_id == row.id).delete(synchronize_session=False)
    _purge_dependents(db, row)
    db.delete(row)
    db.flush()


def _gone(model, *conds):
    """Rows already in the recycle bin (soft-deleted), matching the conditions."""
    return (model.is_deleted == True,) + conds  # noqa: E712


def _purge_dependents(db: Session, row) -> None:
    """Remove what only exists for this record, so it can go: its price history, and the
    soft-deleted locations under it. Active records that still use it are left alone and the
    database refuses the delete (the message names them)."""
    def drop(model, *conds):
        db.query(model).filter(*conds).delete(synchronize_session=False)

    if isinstance(row, MembershipType):
        drop(MembershipTypePrice, MembershipTypePrice.membership_type_id == row.id)
    elif isinstance(row, Taluk):
        drop(PostalCode, *_gone(PostalCode, PostalCode.taluk_id == row.id))
    elif isinstance(row, District):
        drop(PostalCode, *_gone(PostalCode, PostalCode.district_id == row.id))
        for (tid,) in db.query(Taluk.id).filter(*_gone(Taluk, Taluk.district_id == row.id)).all():
            drop(PostalCode, *_gone(PostalCode, PostalCode.taluk_id == tid))
        drop(Taluk, *_gone(Taluk, Taluk.district_id == row.id))
    elif isinstance(row, State):
        drop(PostalCode, *_gone(PostalCode, PostalCode.state_id == row.id))
        for (did,) in db.query(District.id).filter(*_gone(District, District.state_id == row.id)).all():
            _purge_dependents(db, db.get(District, did))
        drop(District, *_gone(District, District.state_id == row.id))


def purge(db: Session, items: list, viewer=None) -> dict:
    done, failed = 0, []
    hidden = _hidden(db, viewer)
    for it in items:
        e, row = _get(db, it["entity"], it["id"], hidden)
        if not row:
            failed.append({"key": f"{it['entity']}:{it['id']}", "error": "Not in the recycle bin any more."})
            continue
        label = e.name(row)
        try:
            with db.begin_nested():
                _purge_row(db, e, row)
            done += 1
        except SQLAlchemyError as exc:
            db.expire_all()
            logger.warning("recycle bin purge of %s #%s failed: %s", it["entity"], it["id"], exc)
            failed.append({"key": f"{it['entity']}:{it['id']}", "name": label, "error": _why_not_deleted(exc)})
    db.commit()
    return {"deleted": done, "failed": failed}


def all_items(db: Session, entity: Optional[str] = None, viewer=None) -> list:
    hidden = _hidden(db, viewer)
    out = []
    for e in ENTITIES.values():
        if entity and e.key != entity:
            continue
        out += [{"entity": e.key, "id": i} for (i,) in _bin_query(db, e, hidden).with_entities(e.model.id).all()]
    return out
