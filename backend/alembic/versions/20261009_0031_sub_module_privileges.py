"""Sub-module privileges: Read / Write / Delete per Masters page and per Engagements area.

Revision ID: 20261009_0031
Revises: 20261009_0030
Create Date: 2026-10-09

* seeds the sub-module rows and their privileges (masters.banks.read, ...),
* points each Masters menu page at its own Read privilege (only while it still has the old one),
* so nothing stops working: every role that holds masters.* / engagements.* today is granted the
  matching privilege of every sub-module, with the same "needs approval" flag.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0031"
down_revision = "20261009_0030"
branch_labels = None
depends_on = None

_PAGE_READ = {
    "masters.location": "masters.location.read",
    "masters.membership_types": "masters.membership_types.read",
    "masters.particulars": "masters.particulars.read",
    "masters.payment_modes": "masters.payment_modes.read",
    "masters.banks": "masters.banks.read",
}


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import SUB_MODULE_AREAS, seed_menu_pages, seed_modules, seed_permissions
        from models.users import Module, Permission, RolePermission

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)

        for code, new_read in _PAGE_READ.items():
            page = session.query(Module).filter(Module.code == code, Module.is_deleted == False).first()  # noqa: E712
            if page and page.permission_code == "masters.read":
                page.permission_code = new_read

        perms = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712
        for module, areas in SUB_MODULE_AREAS.items():
            for action in ("read", "write", "delete"):
                base = perms.get(f"{module}.{action}")
                if not base:
                    continue
                grants = session.query(RolePermission).filter(
                    RolePermission.permission_id == base.id, RolePermission.is_deleted == False  # noqa: E712
                ).all()
                for grant in grants:
                    held = {
                        r.permission_id for r in session.query(RolePermission).filter(
                            RolePermission.role_id == grant.role_id, RolePermission.is_deleted == False  # noqa: E712
                        ).all()
                    }
                    for sub, _label, _paths in areas:
                        sub_perm = perms.get(f"{sub}.{action}")
                        if sub_perm and sub_perm.id not in held:
                            session.add(RolePermission(
                                role_id=grant.role_id, permission_id=sub_perm.id,
                                requires_approval=grant.requires_approval,
                            ))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
