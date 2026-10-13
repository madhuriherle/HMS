"""Planned screens of the not-yet-built modules, as neat (switched-off) sub-modules.

Revision ID: 20261009_0033
Revises: 20261009_0032
Create Date: 2026-10-09

Used to add switched-off placeholder rows for screens that were only planned. They were dead rows in the
Module Master, so nothing is added any more (migration 0049 removes the ones already created).
"""

revision = "20261009_0033"
down_revision = "20261009_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
