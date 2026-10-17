"""A particular says for itself whether it pays for a membership and whether it needs a description.

Revision ID: 20261017_0087
Revises: 20261016_0086

Until now the system guessed both from the particular's NAME ("membership" in the name, exactly "Others"). Now the main
particular carries two yes/no ticks:
  particulars.pays_for_membership  - its money counts toward a member's membership credit
  particulars.needs_description    - Receipt Entry asks for a description (when it has no sub types)
and every receipt line keeps a copy of the first one as it was when the receipt was saved
(receipt_items.pays_for_membership), so changing a tick later never rewrites an old member's credit.

Existing data keeps behaving exactly as before: the main particulars with "membership" in the name are ticked and every
existing Membership / Type change line is marked as paying for membership. Nothing is ticked "needs a description": a
particular with sub types (like Others) already gets its description from the sub type, and the tick can be set by hand.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261017_0087"
down_revision = "20261016_0086"
branch_labels = None
depends_on = None


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "pays_for_membership" not in _cols(bind, "particulars"):
        op.add_column("particulars", sa.Column("pays_for_membership", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "needs_description" not in _cols(bind, "particulars"):
        op.add_column("particulars", sa.Column("needs_description", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "pays_for_membership" not in _cols(bind, "receipt_items"):
        op.add_column("receipt_items", sa.Column("pays_for_membership", sa.Boolean(), nullable=False, server_default=sa.false()))
    flags = {"yes": True, "no": False}
    bind.execute(sa.text(
        "UPDATE particulars SET pays_for_membership = :yes "
        "WHERE parent_id IS NULL AND LOWER(name_en) LIKE '%membership%'"), flags)
    bind.execute(sa.text(
        "UPDATE receipt_items SET pays_for_membership = :yes WHERE UPPER(item_type) IN ('MEMBERSHIP', 'TYPE_CHANGE')"), flags)


def downgrade() -> None:
    op.drop_column("receipt_items", "pays_for_membership")
    op.drop_column("particulars", "needs_description")
    op.drop_column("particulars", "pays_for_membership")
