from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload


def test_recreate_after_delete_and_in_use_guards(client, admin_headers):
    h, s = admin_headers, _sfx()
    P = lambda path, **kw: client.post(f"{API}{path}", headers=h, **kw)
    D = lambda path: client.delete(f"{API}{path}", headers=h, params={"reason": "t"})
    for path, body in [
        ("/masters/banks", {"name_en": "B" + s, "code": "B" + s}),
        ("/masters/membership-types", {"name_en": "M" + s, "code": "M" + s, "status": True}),
        ("/masters/document-types", {"name_en": "D" + s, "code": "D" + s}),
        ("/users/roles", {"name": "R" + s, "code": "R" + s}),
        ("/receipts/", _entry_payload("RC" + s, "X")),
    ]:
        first = P(path, json=body)
        assert first.status_code in (200, 201), (path, first.text)
        assert D(f"{path.rstrip('/')}/{first.json()['id']}").status_code == 200, path
        again = P(path, json=body)
        assert again.status_code in (200, 201), (path, again.text)
        # a live duplicate is still refused
        assert P(path, json=body).status_code in (400, 409, 422), path

    bk = P("/masters/banks", json={"name_en": "BK" + s, "code": "BK" + s}).json()
    pm = P("/masters/payment-modes", json={"payment_mode": "NB" + s, "payment_type": "Online", "bank_id": bk["id"], "status": True})
    assert pm.status_code == 201
    blocked = D(f"/masters/banks/{bk['id']}")
    assert blocked.status_code == 409 and "payment mode" in blocked.json()["detail"]
    assert D(f"/masters/payment-modes/{pm.json()['id']}").status_code == 200
    assert D(f"/masters/banks/{bk['id']}").status_code == 200


def test_deleting_particular_deletes_its_sub_types(client, admin_headers):
    h, s = admin_headers, _sfx()
    par = client.post(f"{API}/masters/particulars", headers=h, json={"name_en": "Par" + s, "code": "PA" + s}).json()
    sub = client.post(f"{API}/masters/particulars", headers=h,
                      json={"name_en": "Sub" + s, "code": "SU" + s, "parent_id": par["id"]}).json()
    assert client.delete(f"{API}/masters/particulars/{par['id']}", headers=h, params={"reason": "t"}).status_code == 200
    ids = {x["id"] for x in client.get(f"{API}/masters/particulars?limit=2000", headers=h).json()["data"]}
    assert par["id"] not in ids and sub["id"] not in ids
