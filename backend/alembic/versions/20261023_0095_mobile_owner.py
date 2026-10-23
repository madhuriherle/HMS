"""Whose mobile / WhatsApp number it is.

Revision ID: 20261023_0095
Revises: 20261022_0094

members.mobile_owner_name, whatsapp_owner_relation, whatsapp_owner_name: for a number that belongs to someone else
(a shared family mobile). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261023_0095"
down_revision = "20261022_0094"
branch_labels = None
depends_on = None

COLUMNS = (("mobile_owner_name", 150), ("whatsapp_owner_relation", 30), ("whatsapp_owner_name", 150))


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("members")}
    for name, size in COLUMNS:
        if name not in have:
            op.add_column("members", sa.Column(name, sa.String(size), nullable=True))


def downgrade() -> None:
    for name, _ in COLUMNS:
        op.drop_column("members", name)
