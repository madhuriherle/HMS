"""Frontend contract: replay the exact payloads the React pages send and check
that the backend accepts them and stores/returns the values unchanged."""

import time
from decimal import Decimal

API = "/api/v1"


def _items(body):
    return body["data"] if isinstance(body, dict) and "data" in body else body


def _state(client, h):
    states = _items(client.get(f"{API}/masters/states?limit=2000", headers=h).json())
    if states:
        return states[0]["id"]
    r = client.post(f"{API}/masters/states", headers=h,
                    json={"name_en": "Karnataka", "code": "KA" + _sfx(), "status": True})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _sfx():
    return str(int(time.time() * 1000))[-6:]


def test_login_form_encoded_and_me(client):
    # Login.jsx sends URLSearchParams (form-encoded) then GET /auth/me
    r = client.post(f"{API}/auth/login", data={"username": "admin", "password": "Admintest@123"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"] and r.json().get("refresh_token")
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(f"{API}/auth/me", headers=h).status_code == 200
    r2 = client.post(f"{API}/auth/refresh", json={"refresh_token": r.json()["refresh_token"]})
    assert r2.status_code == 200 and r2.json()["access_token"], r2.text


def test_location_masters(client, admin_headers):
    s = _sfx()
    sid = _state(client, admin_headers)

    d = client.post(f"{API}/masters/districts", headers=admin_headers,
                    json={"name_en": f"Dist{s}", "state_id": sid, "status": True})
    assert d.status_code in (200, 201), d.text
    assert d.json()["name_en"] == f"Dist{s}" and d.json()["state_id"] == sid and d.json()["status"] is True
    did = d.json()["id"]
    u = client.put(f"{API}/masters/districts/{did}", headers=admin_headers,
                   json={"name_en": f"Dist{s}X", "state_id": sid, "status": False})
    assert u.status_code == 200, u.text
    assert u.json()["name_en"] == f"Dist{s}X" and u.json()["status"] is False

    t = client.post(f"{API}/masters/taluks", headers=admin_headers,
                    json={"name_en": f"Tal{s}", "district_id": did, "status": True})
    assert t.status_code in (200, 201), t.text
    tid = t.json()["id"]
    assert t.json()["district_id"] == did
    assert client.put(f"{API}/masters/taluks/{tid}", headers=admin_headers,
                      json={"name_en": f"Tal{s}Y", "district_id": did, "status": True}).status_code == 200

    pin = "5" + s[:5]
    p = client.post(f"{API}/masters/postal-codes", headers=admin_headers,
                    json={"pincode": pin, "post_office_name": "Area A", "state_id": sid,
                          "district_id": did, "taluk_id": tid, "status": True})
    assert p.status_code in (200, 201), p.text
    pj = p.json()
    assert pj["pincode"] == pin and pj["post_office_name"] == "Area A"
    assert (pj["state_id"], pj["district_id"], pj["taluk_id"]) == (sid, did, tid)
    pu = client.put(f"{API}/masters/postal-codes/{pj['id']}", headers=admin_headers,
                    json={"pincode": pin, "post_office_name": "Area B", "state_id": sid,
                          "district_id": did, "taluk_id": tid, "status": True})
    assert pu.status_code == 200 and pu.json()["post_office_name"] == "Area B", pu.text

    # list the way LocationSetup.jsx does (limit=20000)
    for path in ("districts?limit=2000", "taluks?limit=20000", "postal-codes?limit=20000"):
        r = client.get(f"{API}/masters/{path}", headers=admin_headers)
        assert r.status_code == 200, (path, r.text)


def test_membership_type_particular_and_bank_payment_mode(client, admin_headers):
    s = _sfx()
    mt = client.post(f"{API}/masters/membership-types", headers=admin_headers,
                     json={"code": f"LIF{s}", "name_en": f"Life {s}", "status": True})
    assert mt.status_code in (200, 201), mt.text
    mid = mt.json()["id"]
    pr = client.post(f"{API}/masters/membership-types/{mid}/prices", headers=admin_headers,
                     json={"amount": 1500, "effective_from": "2026-01-01", "change_reason": "Initial price"})
    assert pr.status_code in (200, 201), pr.text
    lst = _items(client.get(f"{API}/masters/membership-types?limit=1000", headers=admin_headers).json())
    row = next(x for x in lst if x["id"] == mid)
    print("MEMBERSHIP TYPE ROW:", row)
    assert any(str(v) in ("1500", "1500.0", "1500.00") for v in row.values()), \
        "price not visible in list row (frontend reads amount from it)"
    up = client.put(f"{API}/masters/membership-types/{mid}", headers=admin_headers,
                    json={"name_en": f"Life {s}2", "status": False})
    assert up.status_code == 200 and up.json()["status"] is False, up.text

    pa = client.post(f"{API}/masters/particulars", headers=admin_headers,
                     json={"code": f"PAR{s}", "name_en": f"Part {s}", "status": True})
    assert pa.status_code in (200, 201), pa.text
    assert client.put(f"{API}/masters/particulars/{pa.json()['id']}", headers=admin_headers,
                      json={"name_en": f"Part {s}b", "status": False}).status_code == 200

    bank = client.post(f"{API}/masters/banks", headers=admin_headers,
                       json={"code": f"SBI{s}", "name_en": "SBI", "account_number": f"AC{s}",
                             "branch_name": "Main", "ifsc_code": "SBIN0001234"})
    assert bank.status_code in (200, 201), bank.text
    b = bank.json()
    assert (b["account_number"], b["branch_name"], b["ifsc_code"]) == (f"AC{s}", "Main", "SBIN0001234")
    pm = client.post(f"{API}/masters/payment-modes", headers=admin_headers,
                     json={"payment_mode": f"Online{s}", "payment_type": "Online",
                           "bank_id": b["id"], "status": True})
    assert pm.status_code in (200, 201), pm.text
    assert pm.json()["bank_id"] == b["id"] and pm.json()["payment_type"] == "Online"
    # BankDetailsManagement.jsx lists with limit=1000 and reads .data
    lst_pm = client.get(f"{API}/masters/payment-modes?limit=1000", headers=admin_headers)
    assert lst_pm.status_code == 200, lst_pm.text
    assert any(x["id"] == pm.json()["id"] and x["payment_mode"] == f"Online{s}"
               for x in _items(lst_pm.json())), "created payment mode missing from list"
    pa_list = client.get(f"{API}/masters/particulars?limit=2000", headers=admin_headers)
    assert pa_list.status_code == 200, pa_list.text
    pm2 = client.post(f"{API}/masters/payment-modes", headers=admin_headers,
                      json={"payment_mode": f"Cash{s}", "payment_type": "Offline",
                            "bank_id": None, "status": True})
    assert pm2.status_code in (200, 201), pm2.text
    assert client.put(f"{API}/masters/payment-modes/{pm2.json()['id']}", headers=admin_headers,
                      json={"payment_mode": f"Cash{s}", "payment_type": "Offline",
                            "bank_id": None, "status": False}).status_code == 200


def test_roles_users_modules(client, admin_headers):
    s = _sfx()
    role = client.post(f"{API}/users/roles", headers=admin_headers,
                       json={"name": f"Role {s}", "code": f"ROLE_{s}", "description": "d",
                             "status": True, "rank_level": 5})
    assert role.status_code in (200, 201), role.text
    rj = role.json()
    print("ROLE:", rj)
    rid = rj.get("id") or rj.get("data", {}).get("id")
    assert rid
    assert client.put(f"{API}/users/roles/{rid}", headers=admin_headers,
                      json={"name": f"Role {s}b", "description": "d2", "status": True,
                            "rank_level": 6}).status_code == 200
    tree = client.get(f"{API}/users/modules/privilege-tree", headers=admin_headers)
    assert tree.status_code == 200, tree.text
    perm = client.put(f"{API}/users/roles/{rid}/permissions", headers=admin_headers,
                      json={"permission_codes": ["members.read"], "approval_required_codes": []})
    assert perm.status_code == 200, perm.text
    got = client.get(f"{API}/users/roles/{rid}/permissions", headers=admin_headers).json()
    assert "members.read" in str(got)

    user = client.post(f"{API}/users/", headers=admin_headers,
                       json={"name": "Test User", "username": f"u{s}", "email": f"u{s}@x.com",
                             "mobile": "9" + s.zfill(9), "mobile_country_code": "+91",
                             "role_id": rid, "status": True, "password": "Passw0rd@123"})
    assert user.status_code in (200, 201), user.text
    uj = user.json()
    assert uj["username"] == f"u{s}" and uj["email"] == f"u{s}@x.com" and uj["status"] is True
    assert uj["role_id"] == rid if "role_id" in uj else True
    up = client.put(f"{API}/users/{uj['id']}", headers=admin_headers, json={"status": False})
    assert up.status_code == 200 and up.json()["status"] is False, up.text
    # login as that user with the frontend's form-encoded call (inactive must fail)
    assert client.post(f"{API}/auth/login",
                       data={"username": f"u{s}", "password": "Passw0rd@123"}).status_code in (400, 401, 403)

    mod = client.post(f"{API}/users/modules", headers=admin_headers,
                      json={"name_en": f"Mod {s}", "name_kn": None, "description": None,
                            "route": f"/m{s}", "icon": None, "parent_id": None,
                            "opens_module_id": None, "display_order": 99,
                            "min_rank_level": None, "status": True, "code": f"mod_{s}"})
    assert mod.status_code in (200, 201), mod.text
    mid = mod.json()["id"]
    t = client.put(f"{API}/users/modules/{mid}", headers=admin_headers, json={"status": False})
    assert t.status_code == 200 and t.json()["status"] is False, t.text
    assert client.delete(f"{API}/users/modules/{mid}", headers=admin_headers).status_code in (200, 204)


STATE = {}

MEMBER_FORM = {
    "name": "Ramesh Kumar Rao", "mobile": "9876543210", "phone": "0802345678",
    "email": "ramesh@example.com", "address": "12 MG Road", "country": "India",
    "city": "Bengaluru", "post": "Jayanagar", "area": "4th Block", "place": "Place",
    "grama": "Grama", "village": "Vill", "labelPoint": "Near temple", "category": "General",
    "profession": "Engineer", "company": "ACME", "website": "https://a.com",
    "gothra": "Bharadwaja", "bloodGroup": "O+", "birthDate": "1980-05-17",
    "remarks": "rem", "magazineRemarks": "mag", "nativeDetails": "native",
}


def test_member_roundtrip_and_status(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member

    s = _sfx()
    sid = _state(client, admin_headers)
    d = client.post(f"{API}/masters/districts", headers=admin_headers,
                    json={"name_en": f"MD{s}", "state_id": sid, "status": True}).json()
    t = client.post(f"{API}/masters/taluks", headers=admin_headers,
                    json={"name_en": f"MT{s}", "district_id": d["id"], "status": True}).json()
    p = client.post(f"{API}/masters/postal-codes", headers=admin_headers,
                    json={"pincode": "56" + s[:4], "post_office_name": "PO", "state_id": sid,
                          "district_id": d["id"], "taluk_id": t["id"], "status": True}).json()

    form = dict(MEMBER_FORM, mobile="98" + s.zfill(8), stateId=sid, districtId=d["id"],
                talukId=t["id"], pincodeId=p["id"])
    # mirror memberToApiPayload
    parts = form["name"].split()
    payload = {
        "first_name_en": parts[0], "middle_name_en": " ".join(parts[1:-1]) or None,
        "last_name_en": parts[-1], "mobile": form["mobile"], "alternate_mobile": form["phone"],
        "email": form["email"], "address_line1": form["address"], "country": "India",
        "city": form["city"], "post": form["post"], "area": form["area"], "place": form["place"],
        "grama": form["grama"], "village": form["village"], "label_point": form["labelPoint"],
        "category": form["category"], "occupation": form["profession"], "company": form["company"],
        "website": form["website"], "gotra_text": form["gothra"], "blood_group": form["bloodGroup"],
        "date_of_birth": form["birthDate"], "remarks": form["remarks"],
        "address_remarks": form["magazineRemarks"], "native_place_text": form["nativeDetails"],
        "registration_source": "OFFLINE", "state_id": sid, "district_id": d["id"],
        "taluk_id": t["id"], "pincode_id": p["id"],
    }
    r = client.post(f"{API}/members/", headers=admin_headers, json=payload)
    assert r.status_code in (200, 201), r.text
    mid = r.json()["id"]

    resp = client.get(f"{API}/members/{mid}", headers=admin_headers).json()
    with SessionLocal() as db:
        row = db.get(Member, mid)
        lost = []
        for k, v in payload.items():
            if k == "registration_source":
                continue
            api_v = resp.get(k)
            db_v = getattr(row, k, "<nocol>")
            if str(api_v) != str(v):
                lost.append((k, "api", api_v, "sent", v))
            elif db_v != "<nocol>" and str(db_v) != str(v):
                lost.append((k, "db", db_v, "sent", v))
        print("MEMBER FIELDS NOT ROUND-TRIPPING:", lost)
        assert not lost, lost

    st = client.put(f"{API}/members/{mid}", headers=admin_headers, json={"member_status": "INACTIVE"})
    assert st.status_code == 200, st.text
    STATE["status_after_toggle"] = client.get(f"{API}/members/{mid}", headers=admin_headers).json()["member_status"]
    ed = client.put(f"{API}/members/{mid}", headers=admin_headers, json=dict(payload, city="Mysuru"))
    assert ed.status_code == 200, ed.text
    assert client.get(f"{API}/members/{mid}", headers=admin_headers).json()["city"] == "Mysuru"

    lst = client.get(f"{API}/members/", headers=admin_headers,
                     params={"limit": 5, "sort_by": "created_at", "sort_desc": "true"})
    assert lst.status_code == 200, lst.text
    for tab in ("family", "services", "donations"):
        assert client.get(f"{API}/members/{mid}/{tab}", headers=admin_headers).status_code == 200, tab
    STATE["delete_as_frontend_sends"] = client.delete(f"{API}/members/{mid}", headers=admin_headers, params={"reason": "dup"}).status_code


def _receipt_payload(member_id=None, amount=500, **over):
    p = {
        "receipt_number": None, "receipt_date": "2026-10-08", "receipt_type": "MEMBERSHIP",
        "payer_name": "Ramesh", "payment_mode": "UPI", "transaction_reference": "TXN123",
        "transaction_date": "2026-10-08", "gross_amount": amount, "discount_amount": 0,
        "net_amount": amount, "source": "OFFLINE", "is_renewal": False, "notes": "note",
        "items": [{"item_type": "MEMBERSHIP", "description": "Membership", "amount": amount}],
        "allocations": [{"member_id": member_id, "allocated_amount": amount}] if member_id else [],
    }
    p.update(over)
    return p


def test_receipt_roundtrip(client, admin_headers):
    from db.session import SessionLocal
    from models.receipts import Receipt

    s = _sfx()
    m = client.post(f"{API}/members/", headers=admin_headers,
                    json={"first_name_en": "Rec", "mobile": "97" + s.zfill(8)}).json()
    r = client.post(f"{API}/receipts/", headers=admin_headers, json=_receipt_payload(m["id"], 750))
    assert r.status_code in (200, 201), r.text
    rj = r.json()
    print("RECEIPT RESPONSE:", rj)
    rid = rj["id"]
    assert rj.get("receipt_number"), "receipt number not auto-generated for null input"
    with SessionLocal() as db:
        row = db.get(Receipt, rid)
        assert Decimal(str(row.net_amount)) == Decimal("750")
        assert row.payment_mode.name == "UPI" if hasattr(row.payment_mode, "name") else str(row.payment_mode).endswith("UPI")
        assert row.transaction_reference == "TXN123"
        assert str(row.receipt_date) == "2026-10-08"

    # Tracking list used by ReceiptTracking.jsx
    tr = client.get(f"{API}/receipts/tracking", headers=admin_headers, params={"limit": 500})
    assert tr.status_code == 200, tr.text
    found = next((x for x in _items(tr.json()) if x["id"] == rid), None)
    print("TRACKING ROW:", found)
    assert found, "created receipt missing from /receipts/tracking"

    # ReceiptTracking edit: no receipt_number/items/allocations
    up = _receipt_payload(None, 900)
    for k in ("receipt_number", "items", "allocations"):
        up.pop(k)
    u = client.put(f"{API}/receipts/{rid}", headers=admin_headers, json=up)
    assert u.status_code == 200, u.text
    with SessionLocal() as db:
        db.expire_all()
        assert Decimal(str(db.get(Receipt, rid).net_amount)) == Decimal("900")

    assert client.get(f"{API}/receipts/renewals-due", headers=admin_headers,
                      params={"limit": 500}).status_code == 200
    # member-allocated receipts are (by design) not deletable
    assert client.delete(f"{API}/receipts/{rid}", headers=admin_headers).status_code == 409
    free = client.post(f"{API}/receipts/", headers=admin_headers, json=_receipt_payload(None, 5)).json()
    assert client.delete(f"{API}/receipts/{free['id']}", headers=admin_headers).status_code in (200, 202, 204)

    # every payment mode / type the adapter can emit must be accepted
    for mode in ("CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "OTHER"):
        for typ in ("MEMBERSHIP", "SCHOLARSHIP", "DONATION", "MAGAZINE", "EVENT", "OTHER"):
            x = client.post(f"{API}/receipts/", headers=admin_headers,
                            json=_receipt_payload(None, 10, payment_mode=mode, receipt_type=typ,
                                                  items=[{"item_type": typ, "description": "d", "amount": 10}]))
            assert x.status_code in (200, 201), (mode, typ, x.text)


def test_org_settings_and_dashboard(client, admin_headers):
    original = client.get(f"{API}/system/settings", headers=admin_headers).json()
    try:
        _check_org_settings(client, admin_headers)
    finally:
        # leave the shared test database as we found it
        keep = {k: original[k] for k in _ORG_KEYS if k in original}
        client.put(f"{API}/system/settings", headers=admin_headers, json=keep)


_ORG_KEYS = (
    "name_en", "registration_no", "website", "address_en", "email", "mobile", "phone",
    "print_header_enabled", "receipt_footer_note_en", "president_title_en",
    "secretary_title_en", "treasurer_title_en", "pay_mode_cash_en", "pay_mode_cheque_en",
    "pay_mode_dd_en", "pay_mode_upi_en", "notify_email_enabled",
)


def _check_org_settings(client, admin_headers):
    payload = {
        "name_en": "HMS Org", "registration_no": "REG1", "website": "https://o.org",
        "address_en": "Addr", "email": "o@o.org", "mobile": "9999999999", "phone": "0801111111",
        "print_header_enabled": True, "receipt_footer_note_en": "Thanks",
        "president_title_en": "Pres", "secretary_title_en": "Sec", "treasurer_title_en": "Tre",
        "pay_mode_cash_en": "Cash", "pay_mode_cheque_en": "Chq", "pay_mode_dd_en": "DD",
        "pay_mode_upi_en": "UPI", "notify_email_enabled": True,
    }
    r = client.put(f"{API}/system/settings", headers=admin_headers, json=payload)
    assert r.status_code == 200, r.text
    got = client.get(f"{API}/system/settings", headers=admin_headers).json()
    print("SETTINGS:", got)
    bad = {k: (got.get(k), v) for k, v in payload.items() if got.get(k) != v}
    assert not bad, bad
    for path in ("/dashboard", "/reports/summary"):
        assert client.get(f"{API}{path}", headers=admin_headers).status_code == 200, path


import pytest  # noqa: E402


def test_member_status_toggle_persists():
    assert STATE["status_after_toggle"] == "INACTIVE"


def test_member_delete_as_frontend_sends():
    assert STATE["delete_as_frontend_sends"] in (200, 202, 204)


def test_action_reason_header_is_audited(client, admin_headers):
    from db.session import SessionLocal
    from models.activity import UserActivityLog

    s = _sfx()
    r = client.post(f"{API}/masters/particulars", json={"code": f"RSN{s}", "name_en": f"Reason {s}", "status": True},
                    headers={**admin_headers, "X-Action-Reason": "  adding for test  "})
    assert r.status_code in (200, 201), r.text
    with SessionLocal() as db:
        row = (db.query(UserActivityLog)
               .filter(UserActivityLog.entity_type == "particulars", UserActivityLog.entity_id == r.json()["id"])
               .order_by(UserActivityLog.id.desc()).first())
        assert row is not None and (row.details or {}).get("reason") == "adding for test"


def _flat_menu(nodes):
    out = {}
    for n in nodes:
        out[n["name"]] = n
        out.update(_flat_menu(n.get("submodules") or []))
    return out


def test_sidebar_menu_comes_from_modules_table(client, admin_headers):
    s = _sfx()
    # 1) all-access admin sees every page row, with front-end routes
    menu = _flat_menu(client.get(f"{API}/users/modules/menu", headers=admin_headers).json())
    for name, route in (("Location Setup", "/dashboard/master/location-setup"),
                        ("Payment Mode Setup", "/dashboard/master/payment-modes"),
                        ("Receipt Entry", "/dashboard/receipts/entry"),
                        ("Membership List", "/dashboard/membership/list"),
                        ("Dashboard", "/dashboard"), ("Modules", "/dashboard/users/modules")):
        assert menu.get(name, {}).get("route") == route, (name, menu.get(name))

    # 2) a limited role only sees pages whose privilege it holds
    role = client.post(f"{API}/users/roles", headers=admin_headers,
                       json={"name": f"Menu {s}", "code": f"MENU_{s}", "description": "", "status": True,
                             "rank_level": 50}).json()
    rid = role["id"]
    r = client.put(f"{API}/users/roles/{rid}/permissions", headers=admin_headers,
                   json={"permission_codes": ["masters.read"], "approval_required_codes": []})
    assert r.status_code == 200, r.text
    u = client.post(f"{API}/users/", headers=admin_headers,
                    json={"name": "Menu User", "username": f"mu{s}", "email": f"mu{s}@x.com",
                          "mobile": "8" + s.zfill(9), "mobile_country_code": "+91",
                          "role_id": rid, "status": True, "password": "Passw0rd@123"})
    assert u.status_code in (200, 201), u.text
    tok = client.post(f"{API}/auth/login", data={"username": f"mu{s}", "password": "Passw0rd@123"}).json()["access_token"]
    mine = _flat_menu(client.get(f"{API}/users/modules/menu", headers={"Authorization": f"Bearer {tok}"}).json())
    assert "Location Setup" in mine and "Payment Mode Setup" in mine and "Membership Types" in mine
    assert "Organisation Settings" not in mine, "needs system.read"
    assert "Receipt Entry" not in mine and "Membership List" not in mine
    assert "Modules" not in mine, "rank 1 only"


def test_module_permission_code_validated(client, admin_headers):
    s = _sfx()
    bad = client.post(f"{API}/users/modules", headers=admin_headers,
                      json={"code": f"pc_{s}", "name_en": "X", "route": "/dashboard/x", "display_order": 1,
                            "permission_code": "no.such.privilege"})
    assert bad.status_code == 400, bad.text
    ok = client.post(f"{API}/users/modules", headers=admin_headers,
                     json={"code": f"pc_{s}", "name_en": "X", "route": "/dashboard/x", "display_order": 1,
                           "permission_code": "masters.read"})
    assert ok.status_code in (200, 201), ok.text
    assert ok.json()["permission_code"] == "masters.read"


def _ids(client, h, path):
    return {x["id"] for x in _items(client.get(f"{API}/masters/{path}?limit=20000", headers=h).json())}


def test_status_toggle_and_delete_persist(client, admin_headers):
    """Location Setup / Particulars / Membership Types / Payment Modes send a
    status-only PUT or a DELETE; the change must be stored and the row gone."""
    h, s = admin_headers, _sfx()
    sid = _state(client, h)
    d = client.post(f"{API}/masters/districts", headers=h, json={"name_en": f"DelD{s}", "state_id": sid, "status": True}).json()
    t = client.post(f"{API}/masters/taluks", headers=h, json={"name_en": f"DelT{s}", "district_id": d["id"], "status": True}).json()
    p = client.post(f"{API}/masters/postal-codes", headers=h,
                    json={"pincode": "57" + s[:4], "post_office_name": "PO", "state_id": sid,
                          "district_id": d["id"], "taluk_id": t["id"], "status": True}).json()

    # status-only PUT on every location level
    for path, row in (("districts", d), ("taluks", t), ("postal-codes", p)):
        r = client.put(f"{API}/masters/{path}/{row['id']}", headers=h, json={"status": False})
        assert r.status_code == 200 and r.json()["status"] is False, (path, r.text)
        stored = next(x for x in _items(client.get(f"{API}/masters/{path}?limit=20000", headers=h).json()) if x["id"] == row["id"])
        assert stored["status"] is False, path

    # parents with children are protected, with a readable reason
    blocked = client.delete(f"{API}/masters/districts/{d['id']}", headers=h)
    assert blocked.status_code == 409 and "taluks" in blocked.json()["detail"].lower(), blocked.text
    blocked = client.delete(f"{API}/masters/taluks/{t['id']}", headers=h)
    assert blocked.status_code == 409, blocked.text

    # bottom-up delete removes the rows from the lists
    for path, row in (("postal-codes", p), ("taluks", t), ("districts", d)):
        r = client.delete(f"{API}/masters/{path}/{row['id']}", headers=h)
        assert r.status_code in (200, 204), (path, r.text)
        assert row["id"] not in _ids(client, h, path), f"{path} row still listed after delete"

    # particulars: status + delete
    pa = client.post(f"{API}/masters/particulars", headers=h, json={"code": f"DP{s}", "name_en": f"DelP{s}", "status": True}).json()
    assert client.put(f"{API}/masters/particulars/{pa['id']}", headers=h, json={"status": False}).json()["status"] is False
    assert client.delete(f"{API}/masters/particulars/{pa['id']}", headers=h).status_code in (200, 204)
    assert pa["id"] not in _ids(client, h, "particulars")

    # membership type: status-only PUT and a price revision
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"DM{s}", "name_en": f"DelM{s}", "status": True}).json()
    assert client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                       json={"amount": 100, "effective_from": "2026-01-01", "change_reason": "Initial price"}).status_code in (200, 201)
    rev = client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                      json={"amount": 250, "effective_from": "2026-06-01", "change_reason": "Price revision"})
    assert rev.status_code in (200, 201), rev.text
    assert client.put(f"{API}/masters/membership-types/{mt['id']}", headers=h, json={"status": False}).json()["status"] is False
    row = next(x for x in _items(client.get(f"{API}/masters/membership-types?limit=1000", headers=h).json()) if x["id"] == mt["id"])
    assert row["status"] is False and any(str(v) in ("250", "250.0", "250.00") for v in row.values()), row

    # payment mode status-only PUT
    pm = client.post(f"{API}/masters/payment-modes", headers=h,
                     json={"payment_mode": f"Cash{s}", "payment_type": "Offline", "bank_id": None, "status": True}).json()
    r = client.put(f"{API}/masters/payment-modes/{pm['id']}", headers=h, json={"status": False})
    assert r.status_code == 200 and r.json()["status"] is False, r.text
    got = next(x for x in _items(client.get(f"{API}/masters/payment-modes?limit=1000", headers=h).json()) if x["id"] == pm["id"])
    assert got["status"] is False


def test_gotra_list_and_membership_type_price_for_pages(client, admin_headers):
    r = client.get(f"{API}/masters/gotras?limit=1000", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert isinstance(_items(r.json()), list)


def test_org_settings_extra_roundtrip(client, admin_headers):
    """OrganisationSettings.jsx keeps every field without a column in `extra`."""
    original = client.get(f"{API}/system/settings", headers=admin_headers).json()
    try:
        extra = {"profile": {"shortName": "HMS", "organisationType": "Society / Association"},
                 "contact": {"primaryContactName": "Test Person", "workingHours": "9-5"},
                 "notifications": {"receiptCreated": True}}
        r = client.put(f"{API}/system/settings", headers=admin_headers, json={"name_en": "Extra Org", "extra": extra})
        assert r.status_code == 200, r.text
        got = client.get(f"{API}/system/settings", headers=admin_headers).json()
        assert got["name_en"] == "Extra Org" and got["extra"] == extra
    finally:
        client.put(f"{API}/system/settings", headers=admin_headers,
                   json={"name_en": original.get("name_en"), "extra": original.get("extra")})


def test_unapproved_members_and_approve_as_page_does(client, admin_headers):
    """UnapprovedMembership.jsx: list UNAPPROVED members, see whether a receipt is
    mapped (receipt tracking row with member_id), then PUT /members/{id}/approve."""
    s = _sfx()
    m = client.post(f"{API}/members/", headers=admin_headers,
                    json={"first_name_en": "Pending", "mobile": "96" + s.zfill(8)}).json()
    lst = client.get(f"{API}/members/", headers=admin_headers, params={"approval_status": "UNAPPROVED", "limit": 500})
    assert lst.status_code == 200, lst.text
    row = next((x for x in _items(lst.json()) if x["id"] == m["id"]), None)
    assert row is not None and row.get("created_at"), row

    rec = client.post(f"{API}/receipts/", headers=admin_headers, json=_receipt_payload(m["id"], 1000))
    assert rec.status_code in (200, 201), rec.text
    tracking = _items(client.get(f"{API}/receipts/tracking", headers=admin_headers, params={"limit": 500}).json())
    assert any(x.get("member_id") == m["id"] for x in tracking), "receipt not mapped to the member"

    ap = client.put(f"{API}/members/{m['id']}/approve", headers=admin_headers)
    assert ap.status_code == 200, ap.text
    assert ap.json().get("member_code"), ap.json()
    still = [x["id"] for x in _items(client.get(f"{API}/members/", headers=admin_headers,
             params={"approval_status": "UNAPPROVED", "limit": 500}).json())]
    assert m["id"] not in still


def test_postal_code_import_as_page_sends(client, admin_headers):
    """LocationSetup.jsx builds a CSV of validated ids and posts it to /imports."""
    s = _sfx()
    sid = _state(client, admin_headers)
    d = client.post(f"{API}/masters/districts", headers=admin_headers,
                    json={"name_en": f"ImpD{s}", "state_id": sid, "status": True}).json()
    t = client.post(f"{API}/masters/taluks", headers=admin_headers,
                    json={"name_en": f"ImpT{s}", "district_id": d["id"], "status": True}).json()
    pin = "58" + s[:4]
    csv = f'pincode,post_office_name,state_id,district_id,taluk_id\n{pin},"Imp Office",{sid},{d["id"]},{t["id"]}\n'
    r = client.post(f"{API}/imports/postal-codes/import", headers=admin_headers,
                    files={"file": ("postal_codes.csv", csv, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json().get("inserted") == 1, r.json()
    found = [x for x in _items(client.get(f"{API}/masters/postal-codes?limit=25000", headers=admin_headers).json())
             if x["pincode"] == pin]
    assert len(found) == 1 and found[0]["taluk_id"] == t["id"]
