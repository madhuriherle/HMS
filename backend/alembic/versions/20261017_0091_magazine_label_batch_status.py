"""A label batch has a status (Generated, Sent, Cancelled); a subscription is Active, Paused or Stopped.

Revision ID: 20261017_0091
Revises: 20261017_0090

magazine_label_batches.status      GENERATED -> SENT (posted) ; GENERATED -> CANCELLED ; SENT -> GENERATED (undo)
magazine_label_batches.sent_date   the day the batch was posted
magazine_label_batches.cancel_reason

"Sent" used to be inferred from a separate Delivery Batch of the same issue month. Existing batches: a batch whose issue
month has a Dispatched or Completed delivery batch becomes SENT (with that dispatch date); every other batch stays
GENERATED. The old delivery batch rows are kept (read-only). Subscriptions that were CANCELLED become STOPPED (the two
meant the same thing to the label run). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261017_0091"
down_revision = "20261017_0090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("magazine_label_batches")}
    if "status" not in cols:
        op.add_column("magazine_label_batches", sa.Column("status", sa.String(20), nullable=False, server_default="GENERATED"))
    if "sent_date" not in cols:
        op.add_column("magazine_label_batches", sa.Column("sent_date", sa.Date(), nullable=True))
    if "cancel_reason" not in cols:
        op.add_column("magazine_label_batches", sa.Column("cancel_reason", sa.Text(), nullable=True))
    bind.execute(sa.text(
        "UPDATE magazine_label_batches SET status = 'SENT', "
        "sent_date = (SELECT MIN(d.dispatch_date) FROM magazine_delivery_batches d WHERE d.issue_month_year = magazine_label_batches.issue_month_year "
        "AND d.status IN ('DISPATCHED', 'COMPLETED') AND d.is_deleted = :no) "
        "WHERE status = 'GENERATED' AND EXISTS (SELECT 1 FROM magazine_delivery_batches d WHERE d.issue_month_year = magazine_label_batches.issue_month_year "
        "AND d.status IN ('DISPATCHED', 'COMPLETED') AND d.is_deleted = :no)"), {"no": False})
    bind.execute(sa.text("UPDATE magazine_subscriptions SET delivery_status = 'STOPPED' WHERE delivery_status = 'CANCELLED'"))


def downgrade() -> None:
    op.drop_column("magazine_label_batches", "cancel_reason")
    op.drop_column("magazine_label_batches", "sent_date")
    op.drop_column("magazine_label_batches", "status")
