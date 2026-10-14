"""Turn Notifications module on now that its screen is built.

Revision ID: 20261014_0069
Revises: 20261014_0068
Create Date: 2026-10-14

Notifications screen (campaigns, message templates, direct quick send, and system inbox)
is now built at /dashboard/notifications.

* Seed its sidebar page / repoint route to the panel page,
* Switch the module and its sub-modules on (status = true).

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0069"
down_revision = "20261014_0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)

        subs = {
            "notifications.management": "/dashboard/notifications",
        }
        for code, route in subs.items():
            m = session.query(Module).filter(Module.code == code).first()
            if m and (not m.route or m.route != route):
                m.route = route

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if row.code == "notifications" or row.code.startswith("notifications."):
                row.status = True
            if row.code == "notifications" and row.route in ("/notifications", "/dashboard/notifications"):
                row.route = None
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        for row in session.query(Module).filter(Module.is_deleted == False).all():  # noqa: E712
            if row.code == "notifications" or row.code.startswith("notifications."):
                row.status = False
        session.commit()
    finally:
        session.close()
