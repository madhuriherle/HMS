"""Remove the placeholder 'planned screen' modules from the Module Master.

Revision ID: 20261013_0049
Revises: 20261013_0048
Create Date: 2026-10-13

Migration 0033 had added switched-off rows for screens that were only planned (no route, no privileges). They
only filled the Module Master with dead rows. A row is removed only while it is still an untouched placeholder:
switched off, no route, no privilege linked to it, and no child module of its own. Anything an admin changed
since is kept. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0049"
down_revision = "20261013_0048"
branch_labels = None
depends_on = None

PLANNED_CODES = (
    "magazines.subscriptions", "magazines.pauses", "magazines.returns", "magazines.labels",
    "reports.members", "reports.receipts", "reports.magazine_returns", "reports.saved",
    "notifications.templates", "notifications.individual", "notifications.bulk",
    "activity.users", "activity.members", "events.list", "events.guests",
    "imports.postal_codes", "system.files", "system.error_logs",
)


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module, Permission

        for m in session.query(Module).filter(Module.code.in_(PLANNED_CODES), Module.is_deleted == False).all():  # noqa: E712
            if m.status or m.route:
                continue
            has_privilege = session.query(Permission.id).filter(
                Permission.module_id == m.id, Permission.is_deleted == False  # noqa: E712
            ).first()
            has_child = session.query(Module.id).filter(
                Module.parent_id == m.id, Module.is_deleted == False  # noqa: E712
            ).first()
            if has_privilege or has_child:
                continue
            m.is_deleted = True
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
