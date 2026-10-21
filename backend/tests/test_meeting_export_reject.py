"""Unapproved Members: the meeting PDF (logged per applicant), the "Only exported" filter, Disagree (REJECTED) and Re-open."""

from test_frontend_contract import API, _items, _sfx


def _applicant(client, h, name, s):
    return client.post(f"{API}/members/", headers=h, json={
        "first_name_en": name, "mobile": "94" + s.zfill(8), "date_of_birth": "1985-05-05", "address_line1": "1 Main Road",
        "full_name_kn": "ಕನ್ನಡ ಹೆಸರು " + s}).json()


def _ids(client, h, **params):
    r = client.get(f"{API}/members/", headers=h, params={"limit": 200, "with_receipt": True, **params})
    assert r.status_code == 200, r.text
    return {x["id"] for x in _items(r.json())}


def test_meeting_pdf_is_logged_and_filterable(client, admin_headers):
    h, s = admin_headers, _sfx()
    a, b = _applicant(client, h, "Mtg" + s, s), _applicant(client, h, "Mtgb" + s, s[::-1] + "1")
    assert {a["id"], b["id"]} <= _ids(client, h, approval_status="UNAPPROVED", exported=False)

    r = client.post(f"{API}/members/meeting-export", headers=h, json={"member_ids": [a["id"]]})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF"
    day = r.headers["x-export-date"]

    only = _ids(client, h, approval_status="UNAPPROVED", exported=True)
    assert a["id"] in only and b["id"] not in only
    assert a["id"] in _ids(client, h, approval_status="UNAPPROVED", exported_on=day)
    assert a["id"] not in _ids(client, h, approval_status="UNAPPROVED", exported_on="2000-01-01")
    assert a["id"] not in _ids(client, h, approval_status="UNAPPROVED", exported=False)
    row = next(x for x in _items(client.get(f"{API}/members/", headers=h, params={"approval_status": "UNAPPROVED", "with_receipt": True, "limit": 200}).json())
               if x["id"] == a["id"])
    assert row["last_exported_on"] == day

    # an applicant who is not awaiting approval is not exported
    assert client.post(f"{API}/members/meeting-export", headers=h, json={"member_ids": [999999999]}).status_code == 404


def test_disagree_rejects_and_reopen_brings_back(client, admin_headers):
    h, s = admin_headers, _sfx()
    m = _applicant(client, h, "Rej" + s, s)
    assert client.put(f"{API}/members/{m['id']}/reject", headers=h).status_code == 422  # a reason is required
    r = client.put(f"{API}/members/{m['id']}/reject", headers=h, params={"reason": "Not eligible"})
    assert r.status_code == 200, r.text
    assert m["id"] in _ids(client, h, approval_status="REJECTED")
    assert m["id"] not in _ids(client, h, approval_status="UNAPPROVED")
    row = next(x for x in _items(client.get(f"{API}/members/", headers=h, params={"approval_status": "REJECTED", "with_receipt": True, "limit": 200}).json())
               if x["id"] == m["id"])
    assert row["rejection"]["reason"] == "Not eligible"

    # a rejected applicant cannot be approved, nor rejected again, until re-opened
    assert client.put(f"{API}/members/{m['id']}/approve", headers=h).status_code == 409
    assert client.put(f"{API}/members/{m['id']}/reject", headers=h, params={"reason": "again"}).status_code == 409

    assert client.put(f"{API}/members/{m['id']}/reopen", headers=h, params={"reason": "New papers"}).status_code == 200
    assert m["id"] in _ids(client, h, approval_status="UNAPPROVED")
    assert client.put(f"{API}/members/{m['id']}/reopen", headers=h, params={"reason": "x"}).status_code == 409
