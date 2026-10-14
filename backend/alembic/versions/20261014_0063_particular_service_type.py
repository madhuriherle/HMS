"""Link a particular to a service type.

Revision ID: 20261014_0063
Revises: 20261014_0062
Create Date: 2026-10-14

Adds particulars.service_type_id (nullable FK -> service_types.id) so a receipt
line can be attributed to a service (Temple / Mangalya / Hall / Magazine). The
member profile then derives "services used" from the member's assigned receipts
instead of guessing by name. Existing rows stay NULL and are unaffected.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261014_0063"
down_revision = "20261014_0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "particulars" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("particulars")}
    if "service_type_id" in existing:
        return
    op.add_column(
        "particulars",
        sa.Column("service_type_id", sa.BigInteger(), nullable=True),
    )
    try:
        op.create_foreign_key(
            "fk_particulars_service_type_id", "particulars", "service_types",
            ["service_type_id"], ["id"],
        )
    except Exception:
        # SQLite cannot ALTER to add a constraint; the column still exists and
        # the ORM relationship/FK is honoured on Postgres (the only prod target).
        pass
    op.create_index(
        "ix_particulars_service_type_id", "particulars", ["service_type_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "particulars" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("particulars")}
    if "service_type_id" not in existing:
        return
    try:
        op.drop_index("ix_particulars_service_type_id", table_name="particulars")
    except Exception:
        pass
    try:
        op.drop_constraint("fk_particulars_service_type_id", "particulars", type_="foreignkey")
    except Exception:
        pass
    op.drop_column("particulars", "service_type_id")
