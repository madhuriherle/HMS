"""Planned screens of the not-yet-built modules, as neat (switched-off) sub-modules.

Revision ID: 20261009_0033
Revises: 20261009_0032
Create Date: 2026-10-09

Adds the placeholder rows in db.seed_defaults.PLANNED_SCREENS (Magazine, Reports, Notifications, Activity,
Events, Imports, System). Only rows created now are switched off, so a row an admin enabled later is kept.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0033"
down_revision = "20261009_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import PLANNED_SCREENS, seed_modules
        from models.users import Module

        planned = [row[0] for row in PLANNED_SCREENS]
        before = {m.code for m in session.query(Module).filter(Module.code.in_(planned)).all()}
        seed_modules(session)
        for m in session.query(Module).filter(Module.code.in_(planned)).all():
            if m.code not in before:
                m.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
