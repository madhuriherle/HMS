"""Label List, My Profile and Modules get privileges of their own (Dashboard already had one).

Revision ID: 20261017_0089
Revises: 20261017_0088

Label List used to open for anyone who held Membership List; now it is members.label_list.read, given to every role that
holds members.list.read. My Profile (users.my_profile.read / write) is given to every active role, so nobody loses their
own page. Modules (users.modules.read / write) is given to rank-0 roles; the page also stays rank-0 only. The Modules
sidebar row is pointed at users.modules.read. Idempotent.
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261017_0089"
down_revision = "20261017_0088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules, seed_permissions
        from models.users import Module, Permission, Role, RolePermission

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)
        session.flush()

        perms = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712

        def holders(code):
            p = perms.get(code)
            if not p:
                return []
            return session.query(RolePermission).filter(RolePermission.permission_id == p.id, RolePermission.is_deleted == False).all()  # noqa: E712

        def give(role_id, code, requires_approval=False):
            p = perms.get(code)
            if not p:
                return
            have = session.query(RolePermission).filter(RolePermission.role_id == role_id, RolePermission.permission_id == p.id).first()
            if have is None:
                session.add(RolePermission(role_id=role_id, permission_id=p.id, requires_approval=requires_approval))
                session.flush()
            elif have.is_deleted:
                pass  # taken away on purpose: leave it

        for grant in holders("members.list.read"):
            give(grant.role_id, "members.label_list.read", grant.requires_approval)

        roles = session.query(Role).filter(Role.is_deleted == False, Role.status == True).all()  # noqa: E712
        for role in roles:
            give(role.id, "users.my_profile.read")
            give(role.id, "users.my_profile.write")
            if role.rank_level == 0:
                give(role.id, "users.modules.read")
                give(role.id, "users.modules.write")

        row = session.query(Module).filter(Module.code == "users.modules", Module.is_deleted == False).first()  # noqa: E712
        if row is not None and not row.permission_code:
            row.permission_code = "users.modules.read"
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
