"""Actions the panel's lists offer (add / edit / delete / map / refund / approve...):
replay exactly what each button sends and check the server accepts and stores it."""

from test_frontend_contract import (
    API,
    _flat_menu,
    _ids,
    _items,
    _receipt_payload,
    _sfx,
    _state,
)


def test_state_add_edit_delete(client, admin_headers):
    h, s = admin_headers, _sfx()
    st = client.post(f"{API}/masters/states", headers=h, json={"name_en": f"St{s}", "code": f"S{s[:3]}", "status": True})
    assert st.status_code in (200, 201), st.text
    sid = st.json()["id"]
    up = client.put(f"{API}/masters/states/{sid}", headers=h, json={"name_en": f"St{s}X", "code": f"X{s[:3]}"})
    assert up.status_code == 200 and up.json()["name_en"] == f"St{s}X", up.text
    assert client.delete(f"{API}/masters/states/{sid}", headers=h).status_code in (200, 204)
    assert sid not in _ids(client, h, "states")


def test_bank_and_personal_master_crud(client, admin_headers):
    h, s = admin_headers, _sfx()
    b = client.post(f"{API}/masters/banks", headers=h, json={
        "code": f"BK{s}", "name_en": f"Bank{s}", "branch_name": "Main",
        "ifsc_code": "ABCD0001234", "account_number": "1", "status": True})
    assert b.status_code in (200, 201), b.text
    bid = b.json()["id"]
    assert client.put(f"{API}/masters/banks/{bid}", headers=h, json={"branch_name": "Other"}).json()["branch_name"] == "Other"
    assert client.put(f"{API}/masters/banks/{bid}", headers=h, json={"status": False}).json()["status"] is False
    assert client.delete(f"{API}/masters/banks/{bid}", headers=h).status_code in (200, 204)
    assert bid not in _ids(client, h, "banks")

    sid = _state(client, h)
    d = client.post(f"{API}/masters/districts", headers=h, json={"name_en": f"PD{s}", "state_id": sid, "status": True}).json()
    for prefix, body in (
        ("gotras", {"name_en": f"Got{s}", "name_kn": None}),
        ("qualifications", {"name_en": f"Qual{s}", "name_kn": None}),
        ("native-places", {"name_en": f"Nat{s}", "name_kn": None, "district_id": d["id"]}),
    ):
        c = client.post(f"{API}/masters/{prefix}", headers=h, json={**body, "status": True})
        assert c.status_code in (200, 201), (prefix, c.text)
        pid = c.json()["id"]
        assert client.put(f"{API}/masters/{prefix}/{pid}", headers=h, json={"name_en": body["name_en"] + "x"}).status_code == 200
        assert client.put(f"{API}/masters/{prefix}/{pid}", headers=h, json={"status": False}).json()["status"] is False
        assert pid in _ids(client, h, prefix)
        assert client.delete(f"{API}/masters/{prefix}/{pid}", headers=h).status_code in (200, 204)
        assert pid not in _ids(client, h, prefix), prefix


def test_payment_mode_delete(client, admin_headers):
    h, s = admin_headers, _sfx()
    pm = client.post(f"{API}/masters/payment-modes", headers=h, json={
        "payment_mode": f"Del{s}", "payment_type": "Offline", "bank_id": None, "status": True}).json()
    assert client.delete(f"{API}/masters/payment-modes/{pm['id']}", headers=h).status_code in (200, 204)
    listed = {x["id"] for x in _items(client.get(f"{API}/masters/payment-modes?limit=1000", headers=h).json())}
    assert pm["id"] not in listed


def test_receipt_map_refund_cancel(client, admin_headers):
    """ReceiptTracking.jsx: map to a member, remove the mapping, refund, cancel."""
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Map", "mobile": "95" + s.zfill(8)}).json()
    rec = client.post(f"{API}/receipts/", headers=h, json=_receipt_payload(None, 300)).json()
    al = client.post(f"{API}/receipts/{rec['id']}/allocate", headers=h, json={"member_id": m["id"], "allocated_amount": 300})
    assert al.status_code in (200, 201), al.text
    allocs = client.get(f"{API}/receipts/{rec['id']}/allocations", headers=h).json()
    assert len(allocs) == 1 and allocs[0].get("member_name"), allocs
    assert client.delete(f"{API}/receipts/{rec['id']}/allocations/{allocs[0]['id']}", headers=h).status_code in (200, 204)
    assert client.get(f"{API}/receipts/{rec['id']}/allocations", headers=h).json() == []
    rf = client.post(f"{API}/receipts/{rec['id']}/refund", headers=h,
                     json={"amount": 100, "status": "PENDING", "refund_reference": "RF1"})
    assert rf.status_code in (200, 201), rf.text
    cn = client.post(f"{API}/receipts/{rec['id']}/cancel", headers=h, json={"reason": "entered twice"})
    assert cn.status_code == 200, cn.text
    assert str(client.get(f"{API}/receipts/{rec['id']}", headers=h).json()["payment_status"]).upper() == "CANCELLED"
    assert client.post(f"{API}/receipts/{rec['id']}/cancel", headers=h, json={"reason": "again"}).status_code == 400


PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_member_membership_photo_and_reject(client, admin_headers):
    h, s = admin_headers, _sfx()
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"MM{s}", "name_en": f"MT{s}", "status": True}).json()
    client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                json={"amount": 500, "effective_from": "2026-01-01", "change_reason": "Initial price"})
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Prof", "mobile": "94" + s.zfill(8)}).json()
    ms = client.post(f"{API}/members/{m['id']}/memberships", headers=h, json={"membership_type_id": mt["id"]})
    assert ms.status_code in (200, 201), ms.text
    ph = client.post(f"{API}/members/{m['id']}/photo", headers=h, files={"file": ("p.png", PNG, "image/png")})
    assert ph.status_code == 200, ph.text
    # UnapprovedMembership.jsx "Reject": soft delete with a reason
    rj = client.delete(f"{API}/members/{m['id']}", headers=h, params={"reason": "duplicate application", "mode": "SOFT"})
    assert rj.status_code in (200, 202), rj.text
    pending = _items(client.get(f"{API}/members/", headers=h, params={"approval_status": "UNAPPROVED", "limit": 500}).json())
    assert m["id"] not in [x["id"] for x in pending]


def test_approvals_lists_and_label_batch(client, admin_headers):
    h = admin_headers
    for path in ("requests", "deletion-requests", "profile-changes", "type-changes"):
        r = client.get(f"{API}/approvals/{path}", headers=h, params={"status": "PENDING", "limit": 200})
        assert r.status_code == 200, (path, r.text)
        assert "data" in r.json()
    assert client.put(f"{API}/approvals/requests/999999/reject", headers=h, params={"note": "no"}).status_code == 404
    # Label List "Generate batch": create the batch, then fetch its PDF
    g = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2026-10", "only_paid": True})
    assert g.status_code in (200, 201), g.text
    pdf = client.get(f"{API}/magazines/label-batches/{g.json()['batch_id']}/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf"), pdf.text[:200]


def test_module_link_privileges_and_new_menu_pages(client, admin_headers):
    h, s = admin_headers, _sfx()
    mod = client.post(f"{API}/users/modules", headers=h,
                      json={"code": f"lp_{s}", "name_en": f"LP {s}", "display_order": 90, "status": True}).json()
    perms = _items(client.get(f"{API}/users/permissions", headers=h, params={"limit": 500}).json())
    assert perms and "module_id" in perms[0]
    target = next(p for p in perms if p["code"] == "masters.read")
    original_module = target["module_id"]
    try:
        r = client.post(f"{API}/users/modules/{mod['id']}/link-privileges", headers=h, json=[target["id"]])
        assert r.status_code == 200, r.text
        listing = _items(client.get(f"{API}/users/permissions", headers=h, params={"limit": 500}).json())
        assert next(p for p in listing if p["id"] == target["id"])["module_id"] == mod["id"]
    finally:
        client.post(f"{API}/users/modules/{original_module}/link-privileges", headers=h, json=[target["id"]])
    menu = _flat_menu(client.get(f"{API}/users/modules/menu", headers=h).json())
    for name, route in (
        ("Approval Requests", "/dashboard/approvals"),
        ("Bank Master", "/dashboard/master/banks"),
    ):
        assert menu.get(name, {}).get("route") == route, (name, menu.get(name))
