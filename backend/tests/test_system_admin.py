"""Settings > Recycle Bin and Data Cleanup (Super Admin only)."""
import io
import zipfile

import pytest

from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload
from db.session import SessionLocal
from models.activity import UserActivityLog
from services import data_cleanup


def _bin(client, h, **params):
    r = client.get(f"{API}/system/recycle-bin", headers=h, params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _make_particular(client, h):
    s = _sfx()
    r = client.post(f"{API}/masters/particulars", headers=h, json={"code": f"RB{s}", "name_en": f"Bin{s}", "status": True})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"], f"Bin{s}"


def test_deleted_record_can_be_found_restored_and_deleted_for_good(client, admin_headers):
    h = admin_headers
    pid, name = _make_particular(client, h)
    assert client.delete(f"{API}/masters/particulars/{pid}", headers=h).status_code in (200, 204)

    found = _bin(client, h, search=name, entity="particular")
    assert [i["name"] for i in found["data"]] == [name] and found["data"][0]["deleted_by"]
    assert any(t["value"] == "particular" and t["count"] >= 1 for t in found["types"])

    item = {"entity": "particular", "id": pid}
    ok = client.post(f"{API}/system/recycle-bin/restore", headers=h, json={"items": [item]})
    assert ok.status_code == 200 and ok.json()["restored"] == 1 and not ok.json()["failed"]
    assert _bin(client, h, search=name)["total"] == 0

    assert client.delete(f"{API}/masters/particulars/{pid}", headers=h).status_code in (200, 204)
    gone = client.post(f"{API}/system/recycle-bin/purge", headers=h, json={"items": [item]})
    assert gone.status_code == 200 and gone.json()["deleted"] == 1
    assert _bin(client, h, search=name)["total"] == 0
    # nothing left to restore
    again = client.post(f"{API}/system/recycle-bin/restore", headers=h, json={"items": [item]})
    assert again.json()["restored"] == 0 and again.json()["failed"]


def test_restoring_a_clashing_code_is_refused_not_crashed(client, admin_headers):
    h, s = admin_headers, _sfx()
    code = f"CL{s}"
    a = client.post(f"{API}/masters/particulars", headers=h, json={"code": code, "name_en": f"A{s}", "status": True}).json()
    assert client.delete(f"{API}/masters/particulars/{a['id']}", headers=h).status_code in (200, 204)
    b = client.post(f"{API}/masters/particulars", headers=h, json={"code": code, "name_en": f"B{s}", "status": True})
    if b.status_code not in (200, 201):
        pytest.skip("codes may repeat after a delete here")
    r = client.post(f"{API}/system/recycle-bin/restore", headers=h, json={"items": [{"entity": "particular", "id": a["id"]}]})
    assert r.status_code == 200 and r.json()["restored"] == 0 and r.json()["failed"][0]["error"]


def test_deleted_receipt_is_listed_restored_and_purged(client, admin_headers):
    h, s = admin_headers, _sfx()
    number = f"BIN{s}"
    rid = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(number, f"Payer {s}")).json()["id"]
    assert client.delete(f"{API}/receipts/{rid}", headers=h).status_code in (200, 204)
    row = _bin(client, h, search=number, entity="receipt")["data"][0]
    assert number in row["name"] and f"Payer {s}" in row["name"]
    item = {"entity": "receipt", "id": rid}
    assert client.post(f"{API}/system/recycle-bin/restore", headers=h, json={"items": [item]}).json()["restored"] == 1
    assert client.delete(f"{API}/receipts/{rid}", headers=h).status_code in (200, 204)
    assert client.post(f"{API}/system/recycle-bin/purge", headers=h, json={"items": [item]}).json()["deleted"] == 1


def test_empty_recycle_bin_removes_what_it_can(client, admin_headers):
    h = admin_headers
    pid, name = _make_particular(client, h)
    client.delete(f"{API}/masters/particulars/{pid}", headers=h)
    r = client.post(f"{API}/system/recycle-bin/empty", headers=h, json={"entity": "particular"})
    assert r.status_code == 200 and r.json()["deleted"] >= 1
    assert _bin(client, h, entity="particular")["total"] == len(r.json()["failed"])
    assert client.post(f"{API}/system/recycle-bin/empty", headers=h, json={"entity": "nope"}).status_code == 400


def test_a_signed_out_caller_is_refused(client, admin_headers):
    assert client.get(f"{API}/system/recycle-bin").status_code in (401, 403)
    assert client.get(f"{API}/system/cleanup").status_code in (401, 403)


def test_cleanup_groups_never_leave_a_required_link_dangling():
    for key in data_cleanup.GROUPS:
        assert data_cleanup.blockers(data_cleanup.closure([key])) == [], key
    # members need their receipts cleared first
    assert data_cleanup.closure(["members"]) == ["receipts", "members"]


def test_cleanup_needs_the_word_clear_and_keeps_a_log_line(client, admin_headers):
    h = admin_headers
    groups = client.get(f"{API}/system/cleanup", headers=h).json()
    assert groups["confirm_word"] == "CLEAR" and {g["key"] for g in groups["data"]} == set(data_cleanup.GROUPS)

    assert client.post(f"{API}/system/cleanup", headers=h, json={"groups": ["magazines"]}).status_code == 400
    assert client.post(f"{API}/system/cleanup", headers=h, json={"groups": ["nope"], "confirm_text": "CLEAR"}).status_code == 400

    zipped = client.get(f"{API}/system/cleanup/backup", headers=h, params={"groups": "magazines"})
    assert zipped.status_code == 200 and zipped.headers["content-type"] == "application/zip"
    assert "magazine_label_batches.csv" in zipfile.ZipFile(io.BytesIO(zipped.content)).namelist()

    done = client.post(f"{API}/system/cleanup", headers={**h, "X-Action-Reason": "test run"},
                       json={"groups": ["magazines"], "confirm_text": "CLEAR"})
    assert done.status_code == 200 and done.json()["groups"] == ["magazines"]
    with SessionLocal() as db:
        row = db.query(UserActivityLog).filter(UserActivityLog.action == "CLEANUP").order_by(UserActivityLog.id.desc()).first()
        assert row is not None and "Cleared data" in row.description and row.details["reason"] == "test run"


def test_cleanup_deletes_uploaded_files_but_only_inside_the_upload_folder(tmp_path, monkeypatch):
    import os
    from core.config import settings

    up = tmp_path / "uploads"
    (up / "member_photos").mkdir(parents=True)
    mine, outside = up / "member_photos" / "a.png", tmp_path / "keep.txt"
    mine.write_text("x"); outside.write_text("y")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "UPLOAD_DIR", "uploads")
    gone = data_cleanup._delete_files(["uploads/member_photos/a.png", "member_photos/missing.png", "../keep.txt", str(outside)])
    assert gone == 1 and not mine.exists() and outside.exists()
    assert "approvals" in data_cleanup.GROUPS and "refresh_tokens" in data_cleanup.GROUPS["logs"].tables


def test_tools_have_their_own_privileges_and_stay_inside_the_rank_1_settings_module(client, admin_headers):
    from test_sub_modules import _role_user

    tree = client.get(f"{API}/users/modules/privilege-tree", headers=admin_headers).json()

    def find(nodes, code):
        for n in nodes:
            if n["code"] == code:
                return n
            hit = find(n.get("submodules", []), code)
            if hit:
                return hit

    system = find(tree, "system")
    subs = {sub["code"]: {p["code"] for p in sub["privileges"]} for sub in system["submodules"]}
    assert subs["system.recycle_bin"] == {"system.recycle_bin.read", "system.recycle_bin.write"}
    assert subs["system.cleanup"] == {"system.cleanup.read", "system.cleanup.write"}

    # the Settings module is rank 1 only, so a lower-ranked role holding the privileges is still refused
    nobody = _role_user(client, admin_headers, ["masters.read"])
    assert client.get(f"{API}/system/recycle-bin", headers=nobody).status_code == 403
    assert client.get(f"{API}/system/cleanup", headers=nobody).status_code == 403
    assert client.post(f"{API}/system/recycle-bin/restore", headers=nobody, json={"items": [{"entity": "particular", "id": 1}]}).status_code == 403


def test_a_deleted_taluk_with_deleted_pin_codes_and_a_membership_type_with_prices_can_be_removed(client, admin_headers):
    h, s = admin_headers, _sfx()
    st = client.post(f"{API}/masters/states", headers=h, json={"name_en": f"St{s}", "code": f"S{s}"[:6]}).json()
    d = client.post(f"{API}/masters/districts", headers=h, json={"name_en": f"Di{s}", "state_id": st["id"]}).json()
    t = client.post(f"{API}/masters/taluks", headers=h, json={"name_en": f"Ta{s}", "district_id": d["id"]}).json()
    pin = client.post(f"{API}/masters/postal-codes", headers=h, json={
        "pincode": "5" + s[-5:], "post_office_name": f"PO{s}", "state_id": st["id"], "district_id": d["id"], "taluk_id": t["id"]})
    assert pin.status_code in (200, 201), pin.text
    # delete the PIN code first, then the taluk and the district: all sit in the bin, the pin code too
    for path, o in (("postal-codes", pin.json()), ("taluks", t), ("districts", d)):
        assert client.delete(f"{API}/masters/{path}/{o['id']}", headers=h).status_code in (200, 204)
    items = [{"entity": "district", "id": d["id"]}]
    done = client.post(f"{API}/system/recycle-bin/purge", headers=h, json={"items": items}).json()
    assert done["deleted"] == 1 and not done["failed"], done


def test_sidebar_nests_organisation_and_receipt_pages_under_system_settings(client, admin_headers):
    menu = client.get(f"{API}/users/modules/menu", headers=admin_headers).json()
    settings = next(m for m in menu if m["name"] == "Settings")
    hub = next(m for m in settings["submodules"] if m["route"] == "/dashboard/settings")
    assert [c["route"] for c in hub["submodules"]] == ["/dashboard/master/organisation-settings", "/dashboard/system/number-formats"]
    assert not [m for m in settings["submodules"] if m["route"] in ("/dashboard/master/organisation-settings", "/dashboard/system/number-formats")]


def test_organisation_settings_has_its_own_privileges(client, admin_headers):
    tree = client.get(f"{API}/users/modules/privilege-tree", headers=admin_headers).json()

    def find(nodes, code):
        for n in nodes:
            if n["code"] == code:
                return n
            hit = find(n.get("submodules", []), code)
            if hit:
                return hit

    org = find(tree, "masters.organisation")
    assert {p["code"] for p in org["privileges"]} == {"masters.organisation.read", "masters.organisation.write"}
    assert org["permission_code"] == "masters.organisation.read"
    assert client.get(f"{API}/system/settings", headers=admin_headers).status_code == 200


def test_sidebar_shows_only_what_the_role_may_open_and_parents_follow_their_children(client, admin_headers):
    from test_sub_modules import _role_user

    def names(headers):
        menu = client.get(f"{API}/users/modules/menu", headers=headers).json()
        out = {}
        for top in menu:
            out[top["name"]] = [c["name"] for c in top.get("submodules", [])]
        return out

    # a role with one page privilege: that page and its parent group, nothing else
    banks = names(_role_user(client, admin_headers, ["masters.payment_modes.read"]))
    assert banks.get("Masters") == ["Payment Mode Setup"]
    assert "Receipts" not in banks and "Users" not in banks and "Settings" not in banks

    # a role with no page privileges sees no groups at all
    nothing = names(_role_user(client, admin_headers, ["activity.read"]))
    assert "Masters" not in nothing and "Receipts" not in nothing

    # two pages in different groups: both groups appear, each with only its own page
    two = names(_role_user(client, admin_headers, ["masters.payment_modes.read", "receipts.tracking.read"]))
    assert two["Masters"] == ["Payment Mode Setup"] and two["Receipts"] == ["Receipt Tracking"]  # Bulk Mapping has its own privilege


def test_my_profile_returns_contact_and_login_details_and_can_be_edited(client, admin_headers):
    from test_sub_modules import _role_user

    me = client.get(f"{API}/auth/me", headers=admin_headers).json()
    assert {"mobile", "mobile_country_code", "last_login_at", "created_at"} <= set(me)

    h = _role_user(client, admin_headers, ["masters.particulars.read", "users.my_profile.write"])  # editing your own profile is a privilege now
    mine = client.get(f"{API}/auth/me", headers=h).json()
    assert mine["username"].startswith("subm")
    saved = client.put(f"{API}/auth/me", headers=h, json={"name": "Renamed Self", "mobile": "9876501234", "mobile_country_code": "+91"})
    assert saved.status_code == 200, saved.text
    # the edit signs the old session out; log in again with the same password to see the change
    from test_api import STAFF_PW
    tok = client.post(f"{API}/auth/login", data={"username": mine["username"], "password": STAFF_PW}).json()["access_token"]
    after = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert after["name"] == "Renamed Self" and after["mobile"] == "9876501234"
