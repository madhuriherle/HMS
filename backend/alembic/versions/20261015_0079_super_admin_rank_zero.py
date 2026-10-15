"""Super Admin becomes rank 0 (above everyone, never shown); Admin becomes rank 1 and the visible top.

Every role ranked 1..98 moves up one place; the Member role (99) and every module gate follow
(a gate of 1 meant "Super Admin only", it becomes 0).

Revision ID: 20261015_0079
Revises: 20261015_0078
"""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0079"
down_revision = "20261015_0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # already on the new scale (Super Admin is rank 0): nothing to move
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT COUNT(*) FROM roles WHERE code = 'SUPERADMIN' AND rank_level = 1")).scalar() == 0:
        return
    op.execute(sa.text("UPDATE roles SET rank_level = rank_level - 1 WHERE rank_level BETWEEN 1 AND 98"))
    op.execute(sa.text("UPDATE modules SET min_rank_level = min_rank_level - 1 WHERE min_rank_level >= 1"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE modules SET min_rank_level = min_rank_level + 1 WHERE min_rank_level >= 0"))
    op.execute(sa.text("UPDATE roles SET rank_level = rank_level + 1 WHERE rank_level BETWEEN 0 AND 97"))
