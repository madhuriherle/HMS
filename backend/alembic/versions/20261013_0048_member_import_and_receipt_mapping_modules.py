"""Seed Member Import and Bulk Receipt Mapping sidebar modules and permission areas.

Revision ID: 20261013_0048
Revises: 20261013_0047
Create Date: 2026-10-13

* Adds members.import ("Member Import") under Membership module with route /dashboard/membership/import,
  permission_code members.register.write.
* Adds receipts.bulk_mapping ("Bulk Receipt Mapping") under Receipts module with route /dashboard/receipts/bulk-mapping,
  permission_code receipts.tracking.read.
* Seeds menu page rows and synchronizes permissions.

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0048"
down_revision = "20261013_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules, seed_permissions

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
