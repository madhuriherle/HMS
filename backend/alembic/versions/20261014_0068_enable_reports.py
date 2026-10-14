"""Turn Reports module on now that its screen is built.

Revision ID: 20261014_0068
Revises: 20261014_0067
Create Date: 2026-10-14

Reports screen (summary KPIs, members report, receipts/financial collections,
magazines/returns, saved presets, export audit trail) is now built at
/dashboard/reports.

* Seed its sidebar pages / repoint routes to the panel pages,
* Switch the module and its sub-modules on (status = true).

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0068"
down_revision = "20261014_0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        # Clean up any obsolete placeholder module rows if present
        session.query(Module).filter(
            Module.code.in_(("reports.members", "reports.summary", "reports.receipts", "reports.magazines"))
        ).delete(synchronize_session=False)

        seed_menu_pages(session)

        subs = {
            "reports.management": "/dashboard/reports",
        }
        for code, route in subs.items():
            m = session.query(Module).filter(Module.code == code).first()
            if m and (not m.route or m.route != route):
                m.route = route

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if row.code == "reports" or row.code.startswith("reports."):
                row.status = True
            if row.code == "reports" and row.route in ("/reports", "/dashboard/reports"):
                row.route = None
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        for row in session.query(Module).filter(Module.is_deleted == False).all():  # noqa: E712
            if row.code == "reports" or row.code.startswith("reports."):
                row.status = False
        session.commit()
    finally:
        session.close()
