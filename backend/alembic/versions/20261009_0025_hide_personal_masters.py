"""Switch off the Personal Masters menu entry.

Revision ID: 20261009_0025
Revises: 20261009_0024
Create Date: 2026-10-09

The Personal Masters screen (gotra / qualification / native place) is hidden for
now. The module row is only disabled, never deleted, so switching it back on is
one click on the Modules page (or `status = true`). A database that never had
the row is untouched.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0025"
down_revision = "20261009_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "modules" in sa.inspect(bind).get_table_names():
        bind.execute(sa.text("UPDATE modules SET status = false WHERE code = 'masters.personal'"))


def downgrade() -> None:
    bind = op.get_bind()
    if "modules" in sa.inspect(bind).get_table_names():
        bind.execute(sa.text("UPDATE modules SET status = true WHERE code = 'masters.personal'"))
