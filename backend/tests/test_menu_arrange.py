"""Arrange the sidebar: reorder / move modules (Super Admin), and the neat module tree."""

import importlib.util
from pathlib import Path
from unittest import mock

from test_sub_modules import _role_user

API = "/api/v1"


def _modules(client, h):
    return {m["code"]: m for m in client.get(f"{API}/users/modules", headers=h, params={"limit": 500}).json()["data"]}


def _menu_children(client, h, parent_name):
    menu = client.get(f"{API}/users/modules/menu", headers=h).json()
    parent = next(m for m in menu if m["name"] == parent_name)
    return [c["name"] for c in parent["submodules"]]


def test_reorder_changes_the_sidebar_and_can_be_restored(client, admin_headers):
    h = admin_headers
    mods = _modules(client, h)
    masters = mods["masters"]
    kids = sorted((m for m in mods.values() if m["parent_id"] == masters["id"] and m["route"]), key=lambda m: (m["display_order"], m["id"]))
    original = [(m["id"], m["parent_id"], m["display_order"]) for m in kids]
    before = _menu_children(client, h, "Masters")
    assert len(kids) >= 3

    try:
        # reverse the Masters pages
        items = [{"id": m["id"], "parent_id": masters["id"], "display_order": i + 1} for i, m in enumerate(reversed(kids))]
        done = client.put(f"{API}/users/modules/reorder", headers=h, json={"items": items})
        assert done.status_code == 200 and done.json()["updated"] == len(kids), done.text
        after = _menu_children(client, h, "Masters")
        assert after == list(reversed(before)), (before, after)

        # move one page under another parent
        moved = kids[0]
        members = mods["members"]
        assert client.put(f"{API}/users/modules/reorder", headers=h,
                          json={"items": [{"id": moved["id"], "parent_id": members["id"], "display_order": 99}]}).status_code == 200
        assert moved["name_en"] in _menu_children(client, h, "Membership")
        assert moved["name_en"] not in _menu_children(client, h, "Masters")
    finally:
        restore = [{"id": i, "parent_id": p, "display_order": o} for i, p, o in original]
        assert client.put(f"{API}/users/modules/reorder", headers=h, json={"items": restore}).status_code == 200
    assert _menu_children(client, h, "Masters") == before, "restored"


def test_reorder_rejects_bad_requests(client, admin_headers):
    h = admin_headers
    mods = _modules(client, h)
    masters, banks = mods["masters"], mods["masters.banks"]
    # a module cannot go inside its own sub-module, or itself
    assert client.put(f"{API}/users/modules/reorder", headers=h,
                      json={"items": [{"id": masters["id"], "parent_id": banks["id"], "display_order": 1}]}).status_code == 400
    assert client.put(f"{API}/users/modules/reorder", headers=h,
                      json={"items": [{"id": banks["id"], "parent_id": banks["id"], "display_order": 1}]}).status_code == 400
    # unknown ids, unknown parent, duplicates
    assert client.put(f"{API}/users/modules/reorder", headers=h, json={"items": [{"id": 999999, "parent_id": None, "display_order": 1}]}).status_code == 404
    assert client.put(f"{API}/users/modules/reorder", headers=h, json={"items": [{"id": banks["id"], "parent_id": 999999, "display_order": 1}]}).status_code == 400
    assert client.put(f"{API}/users/modules/reorder", headers=h,
                      json={"items": [{"id": banks["id"], "parent_id": masters["id"], "display_order": 1}] * 2}).status_code == 400
    # nothing was changed by the rejected calls
    assert _modules(client, h)["masters"]["parent_id"] is None


def test_only_super_admin_can_rearrange(client, admin_headers):
    mods = _modules(client, admin_headers)
    someone = _role_user(client, admin_headers, ["masters.banks.read"])
    r = client.put(f"{API}/users/modules/reorder", headers=someone,
                   json={"items": [{"id": mods["masters.banks"]["id"], "parent_id": mods["masters"]["id"], "display_order": 1}]})
    assert r.status_code == 403


def test_module_tree_is_neat(client, admin_headers):
    from db.seed_defaults import MENU_PAGE_CATALOG, MODULE_CATALOG

    # the seed itself: every parent exists and no two siblings share an order number
    rows = [(r[0], r[2], r[5]) for r in MODULE_CATALOG] + [(r[0], r[2].split("|")[-1] if r[2] else None, r[5]) for r in MENU_PAGE_CATALOG]
    codes = {c for c, _p, _o in rows}
    siblings = {}
    for code, parent, order in rows:
        assert parent is None or parent in codes, (code, parent)
        siblings.setdefault(parent, []).append((order, code))
    for parent, items in siblings.items():
        orders = [o for o, _c in items]
        assert len(orders) == len(set(orders)), (parent or "top level", sorted(items))

    # and the database matches it (other tests leave their own throw-away modules behind, so only seeded codes are checked)
    mods = _modules(client, admin_headers)
    by_id = {m["id"]: m for m in mods.values()}
    for code in codes:
        m = mods[code]
        assert m["parent_id"] is None or m["parent_id"] in by_id, code
    for code, parent, _order in rows:
        if code in mods and parent and parent in mods and code not in ("approvals.requests",):
            assert by_id[mods[code]["parent_id"]]["code"] == parent, code

    # the planned screens sit under their modules
    for code, parent in (("magazines.subscriptions", "magazines"), ("reports.members", "reports"), ("notifications.bulk", "notifications"),
                         ("events.guests", "events"), ("activity.members", "activity"), ("system.error_logs", "system")):
        assert by_id[mods[code]["parent_id"]]["code"] == parent, code


def test_migration_0033_adds_planned_screens_switched_off(client, admin_headers):
    from db.session import SessionLocal, engine
    from models.users import Module

    with SessionLocal() as db:
        db.query(Module).filter(Module.code == "events.guests").delete()
        db.commit()
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261009_0033_planned_screens.py"
    spec = importlib.util.spec_from_file_location("mig0033", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    try:
        with engine.connect() as conn, mock.patch.object(mig.op, "get_bind", return_value=conn):
            mig.upgrade()
            mig.upgrade()  # idempotent
        with SessionLocal() as db:
            row = db.query(Module).filter(Module.code == "events.guests").first()
            assert row is not None and row.status is False and row.route is None
    finally:
        with SessionLocal() as db:  # the shared test database keeps every module enabled
            for m in db.query(Module).all():
                m.status = True
            db.commit()
