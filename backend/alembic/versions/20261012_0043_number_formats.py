"""number_formats table (member ID / membership number / receipt number formats) + its menu page.

Revision ID: 20261012_0043
Revises: 20261012_0042
Create Date: 2026-10-12

No rows are inserted: until someone saves a format the system uses the formats it always used
(services/numbering.py DEFAULTS), so existing behaviour does not change.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261012_0043"
down_revision = "20261012_0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and "number_formats" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "number_formats",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("doc_type", sa.String(30), nullable=False, unique=True),
            sa.Column("prefix", sa.String(20)),
            sa.Column("date_part", sa.String(20), nullable=False, server_default="NONE"),
            sa.Column("separator", sa.String(2)),
            sa.Column("digits", sa.BigInteger, nullable=False, server_default="6"),
            sa.Column("start_value", sa.BigInteger, nullable=False, server_default="1"),
            sa.Column("restart", sa.String(10), nullable=False, server_default="NEVER"),
            sa.Column("suffix", sa.String(20)),
            sa.Column("allow_manual", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_by", sa.BigInteger),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.Column("updated_by", sa.BigInteger),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.Column("deleted_by", sa.BigInteger),
            sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
        )
    session = Session(bind=bind)
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
    finally:
        session.close()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_table("number_formats")
