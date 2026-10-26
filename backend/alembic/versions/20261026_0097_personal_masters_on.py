"""Switch the Personal Masters menu entry back on (gotra, qualification, native place, name titles).

Revision ID: 20261026_0097
Revises: 20261026_0096

Migration 0025 had only disabled the module row, so this enables it again. A database without the row gets it from the
menu seed at start. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261026_0097"
down_revision = "20261026_0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "modules" in sa.inspect(bind).get_table_names():
        bind.execute(sa.text("UPDATE modules SET status = true WHERE code = 'masters.personal'"))


def downgrade() -> None:
    bind = op.get_bind()
    if "modules" in sa.inspect(bind).get_table_names():
        bind.execute(sa.text("UPDATE modules SET status = false WHERE code = 'masters.personal'"))
