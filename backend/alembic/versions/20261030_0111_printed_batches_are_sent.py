"""A printed label batch is a sent one (the office's rule), so every batch still Generated becomes Sent on its print day.

Revision ID: 20261030_0111
Revises: 20261029_0110
"""
from alembic import op

revision = "20261030_0111"
down_revision = "20261029_0110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE magazine_label_batches SET status = 'SENT', sent_date = generation_date WHERE status = 'GENERATED'")


def downgrade() -> None:
    pass   # the print day cannot be told from a posted date any more
