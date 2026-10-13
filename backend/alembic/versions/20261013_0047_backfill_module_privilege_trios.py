"""Backfill the read/write/delete trio for modules created before auto-provisioning.

Revision ID: 20261013_0047
Revises: 20261013_0046
Create Date: 2026-10-13

Until the "auto-create and link privileges at module birth" change, a module could
be created without any privileges (set up straight in the database or via the old
bare endpoint). This migration gives every live ROUTED module that currently has
none of its own <code>.read/.write/.delete the full trio, linked to it — the same
ladder create_module builds today. Modules that already hold any of the three
(including every seeded screen and the dashboard) are left untouched, and so are
grouping rows without a route. A code that exists but is soft-deleted is revived
onto the module; a live code owned by another module is never stolen.

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0047"
down_revision = "20261013_0046"
branch_labels = None
depends_on = None

_ACTIONS = ("read", "write", "delete")


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module, Permission

        modules = (
            session.query(Module)
            .filter(
                Module.is_deleted == False,  # noqa: E712
                Module.route.isnot(None),
            ).all()
        )
        created = 0
        for m in modules:
            trio = [f"{m.code}.{a}" for a in _ACTIONS]
            own = (
                session.query(Permission)
                .filter(Permission.module_id == m.id, Permission.code.in_(trio))
                .first()
            )
            if own:  # already has (part of) the ladder — handled by the seeds or the feature
                continue
            for a in _ACTIONS:
                code = f"{m.code}.{a}"
                p = session.query(Permission).filter(Permission.code == code).first()
                if p is None:
                    session.add(Permission(
                        module=m.code, module_id=m.id,
                        name=f"{a.title()} {m.name_en}", code=code,
                        description=f"{a.title()} {m.name_en} (backfilled for a module created before auto-provisioning)",
                        status=True,
                    ))
                    created += 1
                elif p.is_deleted:  # revive the soft-deleted row instead of colliding on the unique code
                    p.is_deleted = False
                    p.deleted_at = None
                    p.deleted_by = None
                    p.status = True
                    p.module_id = m.id
                    p.module = m.code
                    created += 1
                # a live code owned by another module is left exactly where it is
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
