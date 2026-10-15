"""Add the gotras the legacy member register uses that the starter list lacked: Bhargava, Atri, Koushika, Haritasa.

Revision ID: 20261015_0083
Revises: 20261015_0082

A gotra is added only when no gotra with that name (any case) exists, so an admin's own list is never duplicated.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261015_0083"
down_revision = "20261015_0082"
branch_labels = None
depends_on = None

NAMES = ["Bhargava", "Atri", "Koushika", "Haritasa"]


def upgrade() -> None:
    bind = op.get_bind()
    have = {r[0].strip().lower() for r in bind.execute(sa.text("SELECT name_en FROM gotras WHERE is_deleted = false")).fetchall()}
    for name in NAMES:
        if name.lower() not in have:
            bind.execute(sa.text("INSERT INTO gotras (name_en, status, is_deleted, created_at) VALUES (:n, true, false, CURRENT_TIMESTAMP)"), {"n": name})


def downgrade() -> None:
    pass
