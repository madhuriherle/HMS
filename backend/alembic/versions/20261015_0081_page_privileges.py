"""Every page of Magazine, Reports and Notifications, Member Import and Assigned for Approval get their own privileges.

Revision ID: 20261015_0081
Revises: 20261015_0080

Before, the two Magazine pages shared magazines.*, the five Reports pages reports.read, the three Notifications pages
notifications.*, Member Import borrowed members.register.write and Assigned for Approval borrowed members.unapproved.*.
Now each page owns its privileges (magazines.subscribers.read, reports.members_report.read, ...).

Nothing stops working: every role that holds the module's privilege today gets the matching privilege of every page,
with the same "needs approval" flag; Member Import goes to the roles that could import (members.register.write or
members.write) and Assigned for Approval to the roles holding Unapproved Members' read / write. The sidebar rows are
pointed at the new privileges (only while they still have the old one). Idempotent.
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261015_0081"
down_revision = "20261015_0080"
branch_labels = None
depends_on = None

_MODULES = ("magazines", "reports", "notifications")


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import AREA_ACTIONS, SUB_MODULE_AREAS, seed_menu_pages, seed_modules, seed_permissions
        from models.users import Permission, RolePermission

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)

        perms = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712

        def held_by(role_id):
            return {
                r.permission_id for r in session.query(RolePermission).filter(
                    RolePermission.role_id == role_id, RolePermission.is_deleted == False  # noqa: E712
                ).all()
            }

        def grants_of(code):
            base = perms.get(code)
            if not base:
                return []
            return session.query(RolePermission).filter(
                RolePermission.permission_id == base.id, RolePermission.is_deleted == False  # noqa: E712
            ).all()

        def give(role_id, code, requires_approval):
            target = perms.get(code)
            if target and target.id not in held_by(role_id):
                session.add(RolePermission(role_id=role_id, permission_id=target.id, requires_approval=requires_approval))
                session.flush()

        # each page of the module: whoever holds the module's action gets the page's action
        for module in _MODULES:
            for action in ("read", "write", "delete"):
                for grant in grants_of(f"{module}.{action}"):
                    for sub, _label, _paths in SUB_MODULE_AREAS[module]:
                        if action in AREA_ACTIONS.get(sub, ("read", "write", "delete")):
                            give(grant.role_id, f"{sub}.{action}", grant.requires_approval)

        # Member Import: the roles that could import before
        for source in ("members.register.write", "members.write"):
            for grant in grants_of(source):
                give(grant.role_id, "members.import.read", grant.requires_approval)
                give(grant.role_id, "members.import.write", grant.requires_approval)
        # Assigned for Approval: the roles that could open / approve from Unapproved Members
        for action in ("read", "write"):
            for grant in grants_of(f"members.unapproved.{action}"):
                give(grant.role_id, f"members.assigned.{action}", grant.requires_approval)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
