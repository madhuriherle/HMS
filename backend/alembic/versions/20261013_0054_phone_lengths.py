"""Phone number lengths per country, and more countries in the calling-code list.

Revision ID: 20261013_0054
Revises: 20261013_0053
Create Date: 2026-10-13

Adds the lookup list phone_lengths (fewest-most digits of a national number, by country) and tops up the
country_codes list with the countries it lacks. Rows already there are never changed; only missing codes are
added. The Register New Member form checks mobile and WhatsApp numbers against these lengths. Idempotent.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0054"
down_revision = "20261013_0053"
branch_labels = None
depends_on = None

LISTS = ("country_codes", "phone_lengths")


def upgrade() -> None:
    bind = op.get_bind()
    if "lookup_values" not in sa.inspect(bind).get_table_names():
        return
    from db.lookup_seed import LOOKUP_DEFAULTS
    from models.masters import LookupValue

    session = Session(bind=bind)
    try:
        for list_code in LISTS:
            rows = (
                session.query(LookupValue)
                .filter(LookupValue.list_code == list_code, LookupValue.is_deleted == False)  # noqa: E712
                .all()
            )
            have = {r.code for r in rows}
            order = max([r.sort_order or 0 for r in rows], default=0)
            for code, label, extra in LOOKUP_DEFAULTS[list_code]:
                if code in have:
                    continue
                order += 1
                session.add(LookupValue(list_code=list_code, code=code, label=label, extra=extra, sort_order=order, status=True))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
