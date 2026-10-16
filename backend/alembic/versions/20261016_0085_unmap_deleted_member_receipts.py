"""Receipts mapped to a deleted member go back to Unassigned.

Revision ID: 20261016_0085
Revises: 20261016_0084

Deleting a member used to leave their receipts mapped to a member nobody can open ("Member not found"). From now on a
deletion un-maps the member's receipts; this cleans up the ones already stuck: every live allocation whose member is
deleted (or gone), or that points at nobody (an associate's allocation is untouched), is marked deleted, and each
affected receipt left without a live allocation becomes UNASSIGNED (a cancelled receipt stays cancelled). Safe to run twice.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261016_0085"
down_revision = "20261016_0084"
branch_labels = None
depends_on = None

_STUCK = """
    a.is_deleted = :no AND (
        (a.member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = a.member_id AND m.is_deleted = :no))
        OR (a.member_id IS NULL AND a.associate_id IS NULL)
    )
"""


def upgrade() -> None:
    bind = op.get_bind()
    flags = {"no": False, "yes": True}
    # receipts saved with a member in one call were stored as UNASSIGNED although they have a live allocation (the status
    # check ran before the allocation was visible): they are ASSIGNED
    bind.execute(sa.text(
        "UPDATE receipts SET receipt_status = 'ASSIGNED' "
        "WHERE receipt_status = 'UNASSIGNED' AND payment_status <> 'CANCELLED' AND is_deleted = :no "
        "AND EXISTS (SELECT 1 FROM receipt_allocations a WHERE a.receipt_id = receipts.id AND a.is_deleted = :no)"
    ), flags)
    ids = [r[0] for r in bind.execute(sa.text(f"SELECT DISTINCT a.receipt_id FROM receipt_allocations a WHERE {_STUCK}"), flags).fetchall()]
    if not ids:
        return
    bind.execute(sa.text(f"UPDATE receipt_allocations SET is_deleted = :yes WHERE id IN (SELECT a.id FROM receipt_allocations a WHERE {_STUCK})"), flags)
    for rid in ids:
        live = bind.execute(sa.text("SELECT 1 FROM receipt_allocations WHERE receipt_id = :r AND is_deleted = :no LIMIT 1"), {"r": rid, "no": False}).first()
        if not live:
            bind.execute(sa.text(
                "UPDATE receipts SET receipt_status = 'UNASSIGNED' "
                "WHERE id = :r AND receipt_status <> 'CANCELLED' AND payment_status <> 'CANCELLED'"
            ), {"r": rid})


def downgrade() -> None:
    pass  # the cleanup is not reversed
