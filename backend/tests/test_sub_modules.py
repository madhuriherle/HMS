"""Sub-module privileges: each Masters page (and each Engagements area) has its own Read / Write / Delete."""

from test_api import STAFF_PW

API = "/api/v1"
_n = [0]


def _role_user(client, admin_headers, codes, approval_codes=()):
    """A user whose role holds EXACTLY these privilege codes (no automatic extras)."""
    _n[0] += 1
    key = f"subm{_n[0]}"
    role = client.post(f"{API}/users/roles", headers=admin_headers, json={"name": key, "code": key.upper(), "rank_level": 10}).json()
    r = client.put(f"{API}/users/roles/{role['id']}/permissions", headers=admin_headers,
                   json={"permission_codes": list(codes), "approval_required_codes": list(approval_codes)})
    assert r.status_code == 200, r.text
    client.post(f"{API}/users/", headers=admin_headers, json={"name": key, "username": key, "password": STAFF_PW, "role_id": role["id"]})
    tok = client.post(f"{API}/auth/login", data={"username": key, "password": STAFF_PW}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_privilege_tree_lists_every_masters_page_with_read_write_delete(client, admin_headers):
    tree = client.get(f"{API}/users/modules/privilege-tree", headers=admin_headers).json()

    def find(nodes, code):
        for n in nodes:
            if n["code"] == code:
                return n
            hit = find(n.get("submodules", []), code)
            if hit:
                return hit

    masters = find(tree, "masters")
    subs = {s["code"]: s for s in masters["submodules"]}
    for code in ("masters.location", "masters.membership_types", "masters.particulars", "masters.payment_modes", "masters.banks"):
        assert {p["code"] for p in subs[code]["privileges"]} == {f"{code}.read", f"{code}.write", f"{code}.delete"}, code
    eng = find(tree, "engagements")
    assert {s["code"] for s in eng["submodules"]} == {
        "engagements.affiliations", "engagements.associates", "engagements.press_media", "engagements.committee"}


def test_one_masters_page_does_not_open_the_others(client, admin_headers):
    banks_only = _role_user(client, admin_headers, ["masters.banks.read", "masters.banks.write"])
    assert client.get(f"{API}/masters/banks", headers=banks_only).status_code == 200
    created = client.post(f"{API}/masters/banks", headers=banks_only, json={"code": "SUBB1", "name_en": "Sub Bank One"})
    assert created.status_code in (200, 201), created.text
    # every other Masters page stays closed, reads and writes
    for path in ("/masters/states", "/masters/payment-modes", "/masters/particulars", "/masters/membership-types", "/masters/document-types"):
        assert client.get(f"{API}{path}", headers=banks_only).status_code == 403, path
    assert client.post(f"{API}/masters/states", headers=banks_only, json={"name_en": "Nope"}).status_code == 403
    # and Bank Master has no delete until it is ticked
    assert client.delete(f"{API}/masters/banks/{created.json()['id']}", headers=banks_only).status_code == 403


def test_module_level_masters_privilege_still_covers_the_other_masters(client, admin_headers):
    other = _role_user(client, admin_headers, ["masters.read"])
    assert client.get(f"{API}/masters/document-types", headers=other).status_code == 200
    assert client.get(f"{API}/masters/banks", headers=other).status_code == 403


def test_needs_approval_is_decided_per_page(client, admin_headers):
    # banks.write needs approval; location.write does not
    user = _role_user(client, admin_headers,
                      ["masters.banks.read", "masters.banks.write", "masters.location.read", "masters.location.write"],
                      approval_codes=["masters.banks.write"])
    bank = client.post(f"{API}/masters/banks", headers=user, json={"code": "SUBB2", "name_en": "Needs Approval Bank"})
    assert bank.status_code in (200, 201, 202) and bank.json().get("status") == "PENDING", bank.text
    state = client.post(f"{API}/masters/states", headers=user, json={"name_en": "Direct Nadu"})
    assert state.status_code in (200, 201) and state.json().get("status") != "PENDING", state.text


def test_engagements_areas_are_separate(client, admin_headers):
    committee_only = _role_user(client, admin_headers, ["engagements.committee.read"])
    assert client.get(f"{API}/engagements/committee/categories", headers=committee_only).status_code == 200
    assert client.get(f"{API}/engagements/affiliations", headers=committee_only).status_code == 403
    assert client.get(f"{API}/engagements/associates", headers=committee_only).status_code == 403


def test_masters_menu_pages_follow_their_own_read_privilege(client, admin_headers):
    banks_only = _role_user(client, admin_headers, ["masters.banks.read"])
    menu = client.get(f"{API}/users/modules/menu", headers=banks_only).json()
    names = set()

    def walk(nodes):
        for n in nodes:
            names.add(n["name"])
            walk(n.get("submodules", []))
    walk(menu)
    assert "Bank Master" in names and "Location Setup" not in names and "Payment Mode Setup" not in names


def test_migration_carries_existing_role_grants_over(client, admin_headers):
    """A role holding only the module-level masters.* / engagements.* codes (as every role did before)
    gets each sub-module's privilege too, with the same 'needs approval' flag; menu pages move to their own Read."""
    import importlib.util
    from pathlib import Path
    from unittest import mock

    from db.session import SessionLocal
    from models.users import Module, Permission, Role, RolePermission

    with SessionLocal() as db:
        role = Role(name="Legacy Masters", code="LEGACY_MASTERS", rank_level=20, status=True)
        db.add(role)
        db.flush()
        by_code = {p.code: p for p in db.query(Permission).all()}
        db.add(RolePermission(role_id=role.id, permission_id=by_code["masters.read"].id, requires_approval=False))
        db.add(RolePermission(role_id=role.id, permission_id=by_code["masters.write"].id, requires_approval=True))
        db.add(RolePermission(role_id=role.id, permission_id=by_code["engagements.read"].id, requires_approval=False))
        # an old-style menu page, still pointing at the shared Masters read privilege
        page = db.query(Module).filter(Module.code == "masters.banks").first()
        page.permission_code = "masters.read"
        db.commit()
        role_id = role.id

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261009_0031_sub_module_privileges.py"
    spec = importlib.util.spec_from_file_location("mig0031", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    from db.session import engine
    with engine.connect() as conn, mock.patch.object(mig.op, "get_bind", return_value=conn):
        mig.upgrade()
        mig.upgrade()  # idempotent

    with SessionLocal() as db:
        grants = {
            (p.code, rp.requires_approval)
            for rp, p in db.query(RolePermission, Permission)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False).all()  # noqa: E712
        }
        codes = {c for c, _ in grants}
        assert {"masters.banks.read", "masters.location.read", "masters.payment_modes.read"} <= codes
        assert ("masters.banks.write", True) in grants and ("masters.location.write", True) in grants, "approval flag carried over"
        assert "masters.banks.delete" not in codes, "only what the role held"
        assert {"engagements.committee.read", "engagements.affiliations.read"} <= codes
        assert db.query(Module).filter(Module.code == "masters.banks").first().permission_code == "masters.banks.read"
