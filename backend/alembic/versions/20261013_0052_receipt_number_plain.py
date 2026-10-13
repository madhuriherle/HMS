"""Receipt numbers become plain counters: 0001, 0002, 0003 ...

Revision ID: 20261013_0052
Revises: 20261013_0051
Create Date: 2026-10-13

Sets the saved receipt number format to no prefix, no date, 4 digits, never restarting. Only the old default
(or no saved format) is replaced; a format the admin chose themselves is left alone. Existing receipts keep
their numbers. The admin can change the format later under Number Formats. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0052"
down_revision = "20261013_0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or "number_formats" not in sa.inspect(bind).get_table_names():
        return
    row = bind.execute(
        sa.text("SELECT id, prefix, date_part, separator, restart FROM number_formats WHERE doc_type='RECEIPT' AND is_deleted = false")
    ).first()
    if row is None:
        bind.execute(sa.text(
            "INSERT INTO number_formats (doc_type, prefix, date_part, separator, digits, start_value, restart, suffix, allow_manual) "
            "VALUES ('RECEIPT', NULL, 'NONE', '', 4, 1, 'NEVER', NULL, true)"
        ))
    elif not row.prefix and row.date_part == "FY" and row.separator == "/" and row.restart == "FY":
        bind.execute(sa.text(
            "UPDATE number_formats SET date_part='NONE', separator='', restart='NEVER' WHERE id = :i"
        ), {"i": row.id})


def downgrade() -> None:
    pass
