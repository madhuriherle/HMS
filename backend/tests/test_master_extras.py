from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload


def test_usage_restore_and_order(client, admin_headers):
    h, s = admin_headers, _sfx()
    P = lambda path, **kw: client.post(f"{API}{path}", headers=h, **kw)
    D = lambda path: client.delete(f"{API}{path}", headers=h, params={"reason": "t"})

    a = P("/masters/particulars", json={"name_en": "OrdA" + s, "code": "OA" + s}).json()
    b = P("/masters/particulars", json={"name_en": "OrdB" + s, "code": "OB" + s}).json()
    sub = P("/masters/particulars", json={"name_en": "Sub" + s, "code": "SU" + s, "parent_id": a["id"]}).json()

    # usage: a receipt line + a sub-type
    P("/receipts/", json=_entry_payload(None, "Use Payer", receipt_date="2017-06-06", gross_amount=100, net_amount=100,
                                        items=[{"item_type": "OTHER", "particular_id": a["id"], "particular_name": a["name_en"], "amount": 100}]))
    usage = client.get(f"{API}/masters/usage/particulars", headers=h).json()["counts"]
    assert usage[str(a["id"])] == {"used": 1, "children": 1}

    # order: B before A, sub-types stay after the parents
    assert client.put(f"{API}/masters/particulars-order", headers=h, json={"ids": [b["id"], a["id"]]}).status_code == 200
    ids = [x["id"] for x in client.get(f"{API}/masters/particulars?limit=2000", headers=h).json()["data"]]
    assert ids.index(b["id"]) < ids.index(a["id"]) < ids.index(sub["id"])

    # restore: deleted B shows up, a live item taking the code blocks the restore
    assert D(f"/masters/particulars/{b['id']}").status_code == 200
    deleted = client.get(f"{API}/masters/deleted/particulars", headers=h).json()["data"]
    assert b["id"] in [x["id"] for x in deleted]
    taker = P("/masters/particulars", json={"name_en": "Taker" + s, "code": "OB" + s}).json()
    blocked = client.post(f"{API}/masters/deleted/particulars/{b['id']}/restore", headers=h)
    assert blocked.status_code == 409 and "OB" + s in blocked.json()["detail"]
    D(f"/masters/particulars/{taker['id']}")
    ok = client.post(f"{API}/masters/deleted/particulars/{b['id']}/restore", headers=h)
    assert ok.status_code == 200
    assert b["id"] in [x["id"] for x in client.get(f"{API}/masters/particulars?limit=2000", headers=h).json()["data"]]
    assert client.get(f"{API}/masters/usage/nonsense", headers=h).status_code == 404


def test_dashboard_collection_cards_and_global_search(client, admin_headers):
    h, s = admin_headers, _sfx()
    from datetime import date
    r = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(None, "Searchable Payerzz", receipt_date=str(date.today()),
                                                                    gross_amount=250, net_amount=250))
    assert r.status_code == 201, r.text
    d = client.get(f"{API}/dashboard/", headers=h).json()["receipts"]
    assert d["today_amount"] >= 250 and d["month_amount"] >= d["today_amount"]
    assert d["unassigned_count"] >= 1 and "renewals_due" in d and "last_month_amount" in d

    found = client.get(f"{API}/dashboard/search", headers=h, params={"q": "Searchable Payerzz"}).json()
    assert [x["id"] for x in found["receipts"]] == [r.json()["id"]]
    assert client.get(f"{API}/dashboard/search", headers=h, params={"q": "x"}).json() == {"members": [], "receipts": []}
