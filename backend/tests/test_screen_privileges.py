"""Membership, Receipts and Approvals: each screen holds its own access; Approvals is its own permission."""

from test_frontend_contract import _sfx
from test_register_member import _payload
from test_sub_modules import API, _role_user


def _applicant(client, admin_headers):
    return client.post(f"{API}/members/", headers=admin_headers, json=_payload(_sfx())).json()["id"]


def test_membership_screens_each_hold_their_own_access(client, admin_headers):
    applicant = _applicant(client, admin_headers)

    only_list = _role_user(client, admin_headers, ["members.list.read"])
    assert client.get(f"{API}/members/", headers=only_list).status_code == 200
    assert client.get(f"{API}/members/{applicant}", headers=only_list).status_code == 200
    assert client.get(f"{API}/members/", headers=only_list, params={"approval_status": "UNAPPROVED"}).status_code == 403
    assert client.post(f"{API}/members/", headers=only_list, json=_payload(_sfx())).status_code == 403

    only_unapproved = _role_user(client, admin_headers, ["members.unapproved.read"])
    assert client.get(f"{API}/members/", headers=only_unapproved, params={"approval_status": "UNAPPROVED"}).status_code == 200
    assert client.get(f"{API}/members/{applicant}", headers=only_unapproved).status_code == 200
    assert client.get(f"{API}/members/", headers=only_unapproved).status_code == 403, "the approved list is not theirs"

    only_register = _role_user(client, admin_headers, ["members.register.write"])
    made = client.post(f"{API}/members/", headers=only_register, json=_payload(_sfx()))
    assert made.status_code in (200, 201), made.text
    assert client.get(f"{API}/members/", headers=only_register).status_code == 403

    # approving belongs to Unapproved Members; editing and deleting to Membership List
    list_writer = _role_user(client, admin_headers, ["members.list.read", "members.list.write", "members.list.delete"])
    assert client.put(f"{API}/members/{applicant}/approve", headers=list_writer).status_code == 403
    approver = _role_user(client, admin_headers, ["members.unapproved.read", "members.unapproved.write"])
    assert client.put(f"{API}/members/{applicant}", headers=approver, json={"first_name_en": "X"}).status_code == 403
    assert client.delete(f"{API}/members/{applicant}", headers=approver).status_code == 403


def test_receipt_entry_and_tracking_are_separate(client, admin_headers):
    entry = _role_user(client, admin_headers, ["receipts.entry.read", "receipts.entry.write"])
    assert client.get(f"{API}/receipts/renewals-due", headers=entry).status_code == 200
    assert client.get(f"{API}/receipts/tracking", headers=entry).status_code == 200, "entry checks existing receipt numbers"
    assert client.get(f"{API}/receipts/", headers=entry).status_code == 403, "the full receipt list is Receipt Tracking's"
    assert client.post(f"{API}/receipts/1/cancel", headers=entry, json={"reason": "x"}).status_code == 403

    tracking = _role_user(client, admin_headers, ["receipts.tracking.read"])
    assert client.get(f"{API}/receipts/tracking", headers=tracking).status_code == 200
    assert client.get(f"{API}/receipts/renewals-due", headers=tracking).status_code == 403
    assert client.post(f"{API}/receipts/", headers=tracking, json={}).status_code == 403


def test_approvals_is_its_own_permission(client, admin_headers):
    viewer = _role_user(client, admin_headers, ["approvals.read"])
    assert client.get(f"{API}/approvals/requests", headers=viewer).status_code == 200
    assert client.put(f"{API}/approvals/requests/999999/approve", headers=viewer).status_code == 403, "reading is not approving"
    no_access = _role_user(client, admin_headers, ["members.list.read", "receipts.tracking.read"])
    assert client.get(f"{API}/approvals/requests", headers=no_access).status_code == 403
    approver = _role_user(client, admin_headers, ["approvals.read", "approvals.write"])
    assert client.put(f"{API}/approvals/requests/999999/approve", headers=approver).status_code == 404, "allowed; the request just does not exist"


def test_migration_0032_moves_roles_retires_old_module_and_switches_off_unbuilt(client, admin_headers):
    import importlib.util
    from pathlib import Path
    from unittest import mock

    from db.session import SessionLocal, engine
    from models.users import Module, Permission, Role, RolePermission

    with SessionLocal() as db:
        # the old combined module as it exists on a database from before this change
        old_mod = db.query(Module).filter(Module.code == "members.approvals").first()
        if not old_mod:
            old_mod = Module(code="members.approvals", name_en="Approvals & Receipt Mapping", route="/members/approvals")
            db.add(old_mod)
            db.flush()
        old = {}
        for a in ("read", "write"):
            perm = db.query(Permission).filter(Permission.code == f"members.approvals.{a}").first()
            if not perm:
                perm = Permission(code=f"members.approvals.{a}", module="members.approvals", module_id=old_mod.id, name=f"{a} old")
                db.add(perm)
                db.flush()
            old[a] = perm
        role = Role(name="Legacy Members", code="LEGACY_MEMBERS", rank_level=20, status=True)
        db.add(role)
        db.flush()
        by_code = {p.code: p for p in db.query(Permission).all()}
        for code, flag in (("members.read", False), ("members.write", True), ("receipts.read", False), ("receipts.write", False)):
            db.add(RolePermission(role_id=role.id, permission_id=by_code[code].id, requires_approval=flag))
        db.add(RolePermission(role_id=role.id, permission_id=old["read"].id, requires_approval=False))
        db.add(RolePermission(role_id=role.id, permission_id=by_code["approvals.write"].id, requires_approval=False))
        db.commit()
        role_id = role.id

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261009_0032_screens_approvals_disable_unbuilt.py"
    spec = importlib.util.spec_from_file_location("mig0032", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    try:
        with engine.connect() as conn, mock.patch.object(mig.op, "get_bind", return_value=conn):
            mig.upgrade()
            mig.upgrade()  # idempotent
        with SessionLocal() as db:
            rows = (
                db.query(RolePermission, Permission).join(Permission, Permission.id == RolePermission.permission_id)
                .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False).all()  # noqa: E712
            )
            grants = {(p.code, rp.requires_approval) for rp, p in rows}
            codes = {c for c, _ in grants}
            assert {"members.list.read", "members.unapproved.read", "receipts.entry.read", "receipts.tracking.read",
                    "receipts.entry.write", "receipts.tracking.write", "approvals.read", "approvals.write"} <= codes
            assert ("members.list.write", True) in grants and ("members.register.write", True) in grants and ("members.unapproved.write", True) in grants
            assert "members.approvals.read" not in codes, "old privilege retired"
            assert db.query(Module).filter(Module.code == "members.approvals", Module.is_deleted == False).count() == 0  # noqa: E712
            assert db.query(Permission).filter(Permission.code == "approvals.write").first().module == "approvals"
            page = db.query(Module).filter(Module.code == "approvals.requests").first()
            assert page.permission_code == "approvals.read"
            assert db.query(Module).filter(Module.id == page.parent_id).first().code == "approvals"
            for code in ("magazines", "reports", "notifications", "activity", "events", "engagements", "engagements.committee", "imports"):
                assert db.query(Module).filter(Module.code == code).first().status is False, code
            for code in ("masters", "members", "receipts", "approvals", "users", "system"):
                assert db.query(Module).filter(Module.code == code).first().status is True, code
        # a switched-off module blocks even the Super Admin on the API
        blocked = client.get(f"{API}/events/", headers=admin_headers)
        assert blocked.status_code == 403 and "disabled" in blocked.text.lower(), blocked.text
    finally:
        with SessionLocal() as db:  # leave the shared test database as the other tests expect it
            for row in db.query(Module).all():
                row.status = True
            db.commit()
