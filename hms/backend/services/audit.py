from datetime import datetime, timezone

from sqlalchemy import event
from sqlalchemy.orm import Session

# Tables that would otherwise log themselves recursively.
_AUDIT_TABLES = {"user_activity_logs", "member_activity_logs"}


def setup_audit_listeners(engine):
    """
    Attach SQLAlchemy event listeners for auto audit logging.

    The acting user is exposed on the session as ``_current_user_id`` by
    ``api.deps.get_current_user`` (the same session instance is shared for the
    whole request), which is what lets every flush be attributed to a user.
    """

    @event.listens_for(Session, "after_flush")
    def _audit_after_flush(session: Session, flush_context):
        current_user_id = getattr(session, "_current_user_id", None)
        if not current_user_id:
            return

        from models.activity import MemberActivityLog, UserActivityLog

        now = datetime.now(timezone.utc)

        def record(action: str, obj) -> None:
            table = getattr(obj, "__tablename__", None)
            if not table or table in _AUDIT_TABLES:
                return
            entity_id = getattr(obj, "id", None)

            session.add(
                UserActivityLog(
                    user_id=current_user_id,
                    action=action,
                    entity_type=table,
                    entity_id=entity_id,
                    created_at=now,
                )
            )

            # Member timeline: any row that belongs to a member (or is the
            # member itself) also lands in member_activity_logs — except when
            # the member is being HARD deleted: that row would immediately FK
            # to a row that no longer exists (the user log still records it).
            if table == "members" and action == "DELETE":
                member_id = None
            else:
                member_id = obj.id if table == "members" else getattr(obj, "member_id", None)
            if member_id is not None:
                session.add(
                    MemberActivityLog(
                        member_id=member_id,
                        action=action,
                        details={"entity_type": table, "entity_id": entity_id},
                        created_at=now,
                    )
                )

        for obj in session.new:
            record("CREATE", obj)

        for obj in session.dirty:
            if session.is_modified(obj):
                record("UPDATE", obj)

        for obj in session.deleted:
            record("DELETE", obj)


def record_activity(
    db: Session,
    *,
    user_id: int,
    action: str,
    entity_type: str = None,
    entity_id: int = None,
    details: dict = None,
    ip_address: str = None,
) -> None:
    """Explicitly log an activity that has no ORM object to hook into.

    Used for events like LOGIN, where there is no authenticated session yet.
    The caller is responsible for committing.
    """
    from models.activity import UserActivityLog

    db.add(
        UserActivityLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            ip_address=ip_address,
        )
    )
