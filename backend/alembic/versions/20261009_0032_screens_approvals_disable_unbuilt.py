"""Approvals is its own module; Membership and Receipts get their screens; unbuilt modules are switched off.

Revision ID: 20261009_0032
Revises: 20261009_0031
Create Date: 2026-10-09

* seeds the Approvals module (approvals.read, approvals.write) and the Membership / Receipts screen
  privileges (members.list.*, members.unapproved.*, members.register.write, receipts.entry.*,
  receipts.tracking.*), and points each menu page at its own privilege,
* moves every role over so nothing stops working: a role holding members.* / receipts.* gets the
  matching privilege of every screen (same "needs approval" flag); a role that could use the old
  "Approvals & Receipt Mapping" privileges (or approve requests) gets approvals.read and the matching
  Unapproved Members privileges,
* retires the old members.approvals module,
* switches off (status = false) the modules whose screens are not built yet.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0032"
down_revision = "20261009_0031"
branch_labels = None
depends_on = None

_PAGE_PERMISSION = {
    "members.list": "members.list.read",
    "members.unapproved": "members.unapproved.read",
    "members.register": "members.register.write",
    "receipts.entry": "receipts.entry.read",
    "receipts.tracking": "receipts.tracking.read",
    "approvals.requests": "approvals.read",
}
_OLD_PAGE_PERMISSION = {  # only replaced while a page still holds the old value
    "members.list": "members.read",
    "members.unapproved": "members.approvals.read",
    "members.register": "members.write",
    "receipts.entry": "receipts.read",
    "receipts.tracking": "receipts.read",
    "approvals.requests": "members.approvals.read",
}


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import AREA_ACTIONS, NOT_BUILT_YET, SUB_MODULE_AREAS, seed_menu_pages, seed_modules, seed_permissions
        from models.users import Module, Permission, RolePermission

        seed_modules(session)
        seed_menu_pages(session)

        # the approve-requests privilege moves from members.approvals to the new Approvals module
        approvals_mod = session.query(Module).filter(Module.code == "approvals", Module.is_deleted == False).first()  # noqa: E712
        write = session.query(Permission).filter(Permission.code == "approvals.write").first()
        if approvals_mod and write and write.module_id != approvals_mod.id:
            write.module = "approvals"
            write.module_id = approvals_mod.id
            write.name = "Approve requests"
        session.flush()
        seed_permissions(session)

        # the Approval Requests page sits under the Approvals module
        page = session.query(Module).filter(Module.code == "approvals.requests", Module.is_deleted == False).first()  # noqa: E712
        if page and approvals_mod and page.parent_id != approvals_mod.id:
            page.parent_id = approvals_mod.id

        for code, new in _PAGE_PERMISSION.items():
            row = session.query(Module).filter(Module.code == code, Module.is_deleted == False).first()  # noqa: E712
            if row and row.permission_code in (_OLD_PAGE_PERMISSION[code], None):
                row.permission_code = new
        session.flush()

        perms = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712

        def grants_of(code):
            base = perms.get(code)
            if not base:
                return []
            return session.query(RolePermission).filter(
                RolePermission.permission_id == base.id, RolePermission.is_deleted == False  # noqa: E712
            ).all()

        def give(role_id, code, flag=False):
            perm = perms.get(code)
            if not perm:
                return
            exists = session.query(RolePermission).filter(
                RolePermission.role_id == role_id, RolePermission.permission_id == perm.id, RolePermission.is_deleted == False  # noqa: E712
            ).first()
            if not exists:
                session.add(RolePermission(role_id=role_id, permission_id=perm.id, requires_approval=flag))

        # members.* / receipts.* -> every screen of the module
        for module in ("members", "receipts"):
            for action in ("read", "write", "delete"):
                for grant in grants_of(f"{module}.{action}"):
                    for sub, _label, _rules in SUB_MODULE_AREAS[module]:
                        if action in AREA_ACTIONS.get(sub, ("read", "write", "delete")):
                            give(grant.role_id, f"{sub}.{action}", grant.requires_approval)

        # the old "Approvals & Receipt Mapping" privileges -> Unapproved Members + the Approvals queue
        for grant in grants_of("members.approvals.read"):
            give(grant.role_id, "members.unapproved.read", grant.requires_approval)
            give(grant.role_id, "approvals.read")
        for grant in grants_of("members.approvals.write"):
            give(grant.role_id, "members.unapproved.write", grant.requires_approval)
        for grant in grants_of("approvals.write"):
            give(grant.role_id, "approvals.read")  # whoever can approve can open the queue

        # retire members.approvals
        for code in ("members.approvals.read", "members.approvals.write"):
            perm = perms.get(code)
            if perm:
                for rp in session.query(RolePermission).filter(RolePermission.permission_id == perm.id).all():
                    rp.is_deleted = True
                perm.is_deleted = True
        old = session.query(Module).filter(Module.code == "members.approvals", Module.is_deleted == False).first()  # noqa: E712
        if old:
            old.is_deleted = True

        # switch off the modules that are not built yet (and their sub-modules)
        for code in NOT_BUILT_YET:
            for row in session.query(Module).filter(Module.code == code).all():
                row.status = False
            for row in session.query(Module).filter(Module.code.like(f"{code}.%")).all():
                row.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
