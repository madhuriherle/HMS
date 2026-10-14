"""Enable Imports module now that all import features are available in their respective pages.

Revision ID: 20261014_0070
Revises: 20261014_0069
Create Date: 2026-10-14

All import capabilities are built directly in their contextual pages:
- Member Bulk Import: /dashboard/membership/import (MemberImport.jsx)
- Postal Code Import: /dashboard/master/location-setup (LocationSetup.jsx)
- Notification Campaign CSV: /notifications/campaigns/csv

* Switch the imports module on (status = true),
* Ensure its route is None so it doesn't appear as a dead link in the sidebar menu.

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0070"
down_revision = "20261014_0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        m = session.query(Module).filter(Module.code == "imports").first()
        if m:
            m.status = True
            m.route = None
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        m = session.query(Module).filter(Module.code == "imports").first()
        if m:
            m.status = False
            m.route = "/imports"
        session.commit()
    finally:
        session.close()
