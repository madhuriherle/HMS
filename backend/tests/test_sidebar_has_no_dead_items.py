"""Every sidebar item opens a real screen: no dead links, no empty modules."""

import importlib.util
import re
from pathlib import Path
from unittest import mock

API = "/api/v1"


def _front_routes():
    app = Path(__file__).resolve().parents[2] / "frontend" / "src" / "App.jsx"
    return {m.group(1) for m in re.finditer(r'<Route path="([^"]+)"', app.read_text(encoding="utf8"))}


def _walk(nodes):
    for n in nodes:
        yield n
        yield from _walk(n.get("submodules", []))


def test_super_admin_sidebar_has_only_real_screens(client, admin_headers):
    from db.seed_defaults import MENU_PAGE_CATALOG, MODULE_CATALOG, NOT_BUILT_YET
    from db.session import SessionLocal
    from models.users import Module

    real = _front_routes()
    assert "master/location-setup" in real, "the route list was read from App.jsx"
    # the live setup: modules whose screens are not built yet are switched off (migration 0032)
    with SessionLocal() as db:
        for code in NOT_BUILT_YET:
            for m in db.query(Module).filter((Module.code == code) | Module.code.like(f"{code}.%")).all():
                m.status = False
        db.commit()
    try:
        menu = client.get(f"{API}/users/modules/menu", headers=admin_headers).json()
    finally:
        with SessionLocal() as db:  # the shared test database keeps every module enabled
            for m in db.query(Module).all():
                m.status = True
            db.commit()
    assert menu, "the sidebar is not empty"
    seeded = {r[0] for r in MODULE_CATALOG} | {r[0] for r in MENU_PAGE_CATALOG}  # other tests leave throw-away modules behind
    for item in _walk(menu):
        if item.get("submodules") or item["code"] not in seeded:
            continue  # a module that only groups its pages
        route = item.get("route") or ""
        ok = route == "/dashboard" or (route.startswith("/dashboard/") and route[len("/dashboard/"):] in real)
        assert ok, f"sidebar item '{item['name']}' ({item['code']}) opens nothing: route={route!r}"
    names = {n["name"] for n in _walk(menu)}
    assert "System" not in names and "Privileges" not in names and "Magazine" not in names, "modules without a screen are not shown"
    assert {"Dashboard", "Masters", "Users", "Membership", "Approvals", "Receipts"} <= names


def test_migration_0034_removes_the_dead_routes(client, admin_headers):
    from db.session import SessionLocal, engine
    from models.users import Module

    with SessionLocal() as db:
        for code, route in (("system", "/system"), ("users.privileges", "/users/privileges")):
            db.query(Module).filter(Module.code == code).first().route = route
        db.commit()
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261009_0034_hide_dead_menu_items.py"
    spec = importlib.util.spec_from_file_location("mig0034", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    with engine.connect() as conn, mock.patch.object(mig.op, "get_bind", return_value=conn):
        mig.upgrade()
        mig.upgrade()  # idempotent
    with SessionLocal() as db:
        assert db.query(Module).filter(Module.code == "system").first().route is None
        assert db.query(Module).filter(Module.code == "users.privileges").first().route is None
