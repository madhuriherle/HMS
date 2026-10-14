"""Turn Events and Engagements modules on now that their screens are built.

Revision ID: 20261014_0067
Revises: 20261014_0066
Create Date: 2026-10-14

Events (events, guests/honours, invitation copy, WhatsApp notify) and
Engagements (affiliations, associates, press & media, committee) screens
are now built at /dashboard/events and /dashboard/engagements.

* Seed their sidebar pages / repoint routes to the panel pages,
* Switch the modules and their sub-modules on (status = true).

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0067"
down_revision = "20261014_0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)

        subs = {
            "engagements.affiliations": "/dashboard/engagements/affiliations",
            "engagements.associates": "/dashboard/engagements/associates",
            "engagements.press_media": "/dashboard/engagements/press-media",
            "engagements.committee": "/dashboard/engagements/committee",
        }
        for code, route in subs.items():
            m = session.query(Module).filter(Module.code == code).first()
            if m and (not m.route or m.route != route):
                m.route = route

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if (
                row.code == "events"
                or row.code.startswith("events.")
                or row.code == "engagements"
                or row.code.startswith("engagements.")
            ):
                row.status = True
            if row.code in ("events", "engagements") and row.route in ("/events", "/engagements"):
                row.route = None
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if (
                row.code == "events"
                or row.code.startswith("events.")
                or row.code == "engagements"
                or row.code.startswith("engagements.")
            ):
                row.status = False
        session.commit()
    finally:
        session.close()
