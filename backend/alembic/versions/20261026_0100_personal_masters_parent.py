"""Personal Masters is the parent page of Gotra, Name Title and Qualification in the sidebar.

Revision ID: 20261026_0100
Revises: 20261026_0099

Switches the Personal Masters page back on and puts the three pages below it. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261026_0100"
down_revision = "20261026_0099"
branch_labels = None
depends_on = None

CHILDREN = (("masters.gotra", 1), ("masters.name_title", 2), ("masters.qualification", 3))


def upgrade() -> None:
    bind = op.get_bind()
    parent = bind.execute(sa.text("SELECT id FROM modules WHERE code = 'masters.personal' AND is_deleted = false")).scalar()
    if parent is None:
        return
    bind.execute(sa.text("UPDATE modules SET status = true WHERE id = :p"), {"p": parent})
    for code, order in CHILDREN:
        bind.execute(sa.text("UPDATE modules SET parent_id = :p, display_order = :o WHERE code = :c AND is_deleted = false"),
                     {"p": parent, "o": order, "c": code})


def downgrade() -> None:
    pass
