"""Only membership payments change the membership type; donations do not.

Revision ID: 20261013_0053
Revises: 20261013_0052
Create Date: 2026-10-13

If a saved membership-credit list is the old default (membership, type change, donations, funds, scholarship),
it is replaced by MEMBERSHIP and TYPE_CHANGE. A list the admin chose themselves is left alone, and with no saved
list the new default applies. Members already upgraded are never moved down. Idempotent.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "20261013_0053"
down_revision = "20261013_0052"
branch_labels = None
depends_on = None

OLD_DEFAULT = {
    "MEMBERSHIP", "TYPE_CHANGE", "GENERAL_DONATION", "DONATION",
    "DONATION_1", "DONATION_2", "DONATION_3", "P_NIDHI", "SCHOLARSHIP",
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or "hms_settings" not in sa.inspect(bind).get_table_names():
        return
    row = bind.execute(sa.text(
        "SELECT id, setting_value FROM hms_settings WHERE setting_key='membership_credit.receipt_types' AND is_deleted = false"
    )).first()
    if row is None:
        return
    value = row.setting_value
    if isinstance(value, str):
        value = json.loads(value)
    if isinstance(value, dict):
        value = value.get("receipt_types")
    if isinstance(value, list) and {str(v).upper() for v in value} == OLD_DEFAULT:
        bind.execute(
            sa.text("UPDATE hms_settings SET setting_value = CAST(:v AS json) WHERE id = :i"),
            {"v": json.dumps({"receipt_types": ["MEMBERSHIP", "TYPE_CHANGE"]}), "i": row.id},
        )


def downgrade() -> None:
    pass
