"""Index every foreign-key column and the main filter columns.

Revision ID: 20261003_0017
Revises: 20261002_0016
Create Date: 2026-10-03

PostgreSQL does not index foreign keys on its own, so joins and look-ups such
as "allocations of a member", "returns of a subscription" or "members of a
district" were sequential scans. The index set is derived in db/indexes.py (the
same function feeds the ORM metadata, so fresh installs get it from 0001).
Existing databases get whatever is missing here; re-running is harmless.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261003_0017"
down_revision = "20261002_0016"
branch_labels = None
depends_on = None


def _load_all_models():
    import models.activity, models.approval_requests, models.engagements, models.events  # noqa: F401
    import models.inbox, models.magazines, models.masters, models.members, models.notifications  # noqa: F401
    import models.receipts, models.reports, models.system, models.users  # noqa: F401


def upgrade() -> None:
    from db.indexes import ensure_indexes
    from models.base import Base

    _load_all_models()
    ensure_indexes(Base.metadata)
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {t: {i["name"] for i in insp.get_indexes(t)} for t in insp.get_table_names()}
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            continue
        for index in table.indexes:
            if index.name.startswith("ix_") and index.name not in existing[table.name]:
                index.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    from db.indexes import ensure_indexes
    from models.base import Base

    _load_all_models()
    new = ensure_indexes(Base.metadata)
    for index in new:
        op.drop_index(index.name, table_name=index.table.name)
