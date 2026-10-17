"""A receipt line points to its sub type by id (it was only text in the description).

Revision ID: 20261017_0088
Revises: 20261017_0087

receipt_items.sub_particular_id  - the sub type the clerk picked (a row of the particulars master, a child of the line's
                                   main particular)
receipt_items.sub_particular_name - the name as it was when the receipt was saved, so history survives a rename

The description column from now on holds only a description someone typed (for a particular ticked "needs a description").

Existing lines: when the description is exactly the name of a sub type of the line's own main particular, the link and
the saved name are filled in. The old description text is left where it is (nothing is deleted); the screens read the sub
type from the link and fall back to the description for a line that did not match.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261017_0088"
down_revision = "20261017_0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("receipt_items")}
    if "sub_particular_id" not in cols:
        op.add_column("receipt_items", sa.Column("sub_particular_id", sa.BigInteger(), sa.ForeignKey("particulars.id"), nullable=True))
    if "sub_particular_name" not in cols:
        op.add_column("receipt_items", sa.Column("sub_particular_name", sa.String(150), nullable=True))
    match = (
        "SELECT c.{col} FROM particulars c WHERE c.parent_id = receipt_items.particular_id "
        "AND LOWER(TRIM(c.name_en)) = LOWER(TRIM(receipt_items.description)) AND c.is_deleted = :no ORDER BY c.id LIMIT 1"
    )
    where = "particular_id IS NOT NULL AND description IS NOT NULL AND sub_particular_id IS NULL"
    bind.execute(sa.text(f"UPDATE receipt_items SET sub_particular_id = ({match.format(col='id')}) WHERE {where}"), {"no": False})
    bind.execute(sa.text(
        "UPDATE receipt_items SET sub_particular_name = (SELECT c.name_en FROM particulars c WHERE c.id = receipt_items.sub_particular_id) "
        "WHERE sub_particular_id IS NOT NULL AND sub_particular_name IS NULL"))


def downgrade() -> None:
    op.drop_column("receipt_items", "sub_particular_name")
    op.drop_column("receipt_items", "sub_particular_id")
