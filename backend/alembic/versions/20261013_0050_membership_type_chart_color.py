"""A dashboard colour for each membership type.

Revision ID: 20261013_0050
Revises: 20261013_0049
Create Date: 2026-10-13

The dashboard pie used a colour table written in the screen's code, by type name. The colour is now a column
on the type, set on the Membership Types screen. The four colours that were in the code are copied onto the
types of the same name, so the dashboard looks the same today. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0050"
down_revision = "20261013_0049"
branch_labels = None
depends_on = None

OLD_COLORS = {
    "Poshaka": "#510601",
    "Mahaposhaka": "#F4AA26",
    "Mahapalaka": "#3D705C",
    "Sahasadasyatva": "#863221",
}


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("membership_types")}
    if "chart_color" not in cols:
        op.add_column("membership_types", sa.Column("chart_color", sa.String(9), nullable=True))
    for name, color in OLD_COLORS.items():
        bind.execute(
            sa.text("UPDATE membership_types SET chart_color = :c WHERE name_en = :n AND chart_color IS NULL"),
            {"c": color, "n": name},
        )


def downgrade() -> None:
    op.drop_column("membership_types", "chart_color")
