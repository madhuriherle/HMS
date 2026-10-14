"""Receipt status cleanup: APPROVED belongs to members, not receipts.

Revision ID: 20261014_0062
Revises: 20261014_0061
Create Date: 2026-10-14

Receipts only have 3 statuses: UNASSIGNED, ASSIGNED, CANCELLED.
Any existing receipt with receipt_status = 'APPROVED' is updated to 'ASSIGNED'.
The 'APPROVED' entry is soft-deleted from lookup_values for list_code 'receipt_statuses'.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0062"
down_revision = "20261014_0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        from models.masters import LookupValue
        from models.receipts import Receipt

        # 1. Update any APPROVED receipts to ASSIGNED
        session.query(Receipt).filter(Receipt.receipt_status == "APPROVED").update(
            {"receipt_status": "ASSIGNED"}, synchronize_session=False
        )

        # 2. Mark APPROVED in lookup_values as deleted
        session.query(LookupValue).filter(
            LookupValue.list_code == "receipt_statuses",
            LookupValue.code == "APPROVED",
        ).update({"is_deleted": True}, synchronize_session=False)

        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
