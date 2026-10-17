"""Assigned for Approval sits under Membership (right after Unapproved Members), not under Approvals.

Revision ID: 20261017_0090
Revises: 20261017_0089

Only the sidebar row moves (seed_menu_pages applies the move while the row is still under Approvals); the privilege
members.assigned.read / write and the route are unchanged. Register New Member and Member Import move down one place to
make room. Idempotent.
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261017_0090"
down_revision = "20261017_0089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules

        seed_modules(session)
        seed_menu_pages(session)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
