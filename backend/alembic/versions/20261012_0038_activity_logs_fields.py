"""User activity log columns and activity menu activation.

Revision ID: 20261012_0038
Revises: 20261012_0037
Create Date: 2026-10-12

Adds description, module, activity_type, status, status_code, http_method,
endpoint_path, client_type to user_activity_logs. Enables the activity module
and routes in the sidebar menu under Users. Idempotent.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261012_0038"
down_revision = "20261012_0037"
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("description", sa.String(255)),
    ("module", sa.String(80)),
    ("activity_type", sa.String(50)),
    ("status", sa.String(20)),
    ("status_code", sa.BigInteger()),
    ("http_method", sa.String(10)),
    ("endpoint_path", sa.String(255)),
    ("client_type", sa.String(50)),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        insp = sa.inspect(bind)
        cols = {c["name"] for c in insp.get_columns("user_activity_logs")}
        for col_name, col_type in NEW_COLUMNS:
            if col_name not in cols:
                op.add_column("user_activity_logs", sa.Column(col_name, col_type, nullable=True))

    session = Session(bind=bind)
    try:
        from models.users import Module
        # Enable the activity module and submodules
        act_mod = session.query(Module).filter(Module.code == "activity").first()
        if act_mod:
            act_mod.status = True
            act_mod.route = "/dashboard/users/activity"
            act_mod.parent_code = "users"  # Submenu of Users as shown in the screenshot
            act_mod.name = "Activity Logs"
            act_mod.display_order = 4
        else:
            session.add(
                Module(
                    code="activity",
                    name="Activity Logs",
                    parent_code="users",
                    route="/dashboard/users/activity",
                    icon="activity",
                    display_order=4,
                    status=True,
                )
            )
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
