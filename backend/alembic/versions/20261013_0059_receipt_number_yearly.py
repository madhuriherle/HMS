"""Receipt numbers: a plain 4-digit number that starts again every financial year (0001, 0002 ...).

Revision ID: 20261013_0059
Revises: 20261013_0058
Create Date: 2026-10-13

Sets the saved receipt number format to no prefix, no date, no separator, 4 digits, restarting every financial
year. Existing receipts keep their numbers. The admin can change the format later under Number Formats. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0059"
down_revision = "20261013_0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or "number_formats" not in sa.inspect(bind).get_table_names():
        return
    row = bind.execute(sa.text("SELECT id FROM number_formats WHERE doc_type='RECEIPT'")).first()
    if row is None:
        bind.execute(sa.text(
            "INSERT INTO number_formats (doc_type, prefix, date_part, separator, digits, start_value, restart, suffix, allow_manual) "
            "VALUES ('RECEIPT', NULL, 'NONE', '', 4, 1, 'FY', NULL, true)"
        ))
    else:
        bind.execute(sa.text(
            "UPDATE number_formats SET prefix=NULL, date_part='NONE', separator='', digits=4, start_value=1, "
            "restart='FY', suffix=NULL, is_deleted=false WHERE id = :i"
        ), {"i": row.id})


def downgrade() -> None:
    pass
