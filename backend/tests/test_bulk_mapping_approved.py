"""Bulk receipt mapping works for approved members as well as applicants."""
from datetime import date

from test_frontend_contract import API, _sfx


def _receipt(client, h, number_on_receipt, name="Payer"):
    r = client.post(f"{API}/receipts/", headers=h, json={
        "receipt_date": date.today().isoformat(), "receipt_type": "MEMBERSHIP", "payment_mode": "CASH", "payer_name": name,
        "payer_membership_no": number_on_receipt,
        "gross_amount": 100, "discount_amount": 0, "net_amount": 100, "items": [{"item_type": "MEMBERSHIP", "amount": 100}]})
    assert r.status_code == 201, r.text
    return r.json()


def test_bulk_mapping_matches_and_maps_an_approved_member(client, admin_headers):
    h, s = admin_headers, _sfx()
    number = "AP-" + s
    mid = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": "Approved", "mobile": "95" + s.zfill(8), "existing_member": True, "existing_membership_number": number}).json()["id"]
    rec = _receipt(client, h, number)

    cands = client.get(f"{API}/receipts/unassigned-candidates", headers=h, params={"filter_type": "MATCHED", "limit": 200}).json()
    mine = [c for c in cands["candidates"] if c["receipt_id"] == rec["id"]]
    assert mine and mine[0]["matched_member"]["id"] == mid and mine[0]["matched_member"]["status"] == "APPROVED"

    done = client.post(f"{API}/receipts/bulk-allocate", headers=h, json={"allocations": [{"receipt_id": rec["id"], "member_id": mid, "allocated_amount": 100}]})
    assert done.status_code == 200 and done.json()["allocated_count"] == 1, done.text
    ledger = client.get(f"{API}/members/{mid}/profile/receipts", headers=h).json()
    assert any(r["receipt_id"] == rec["id"] for r in ledger["data"])


def test_bulk_mapping_manual_search_finds_an_approved_member(client, admin_headers):
    h, s = admin_headers, _sfx()
    number = "AS-" + s
    client.post(f"{API}/members/", headers=h, json={
        "first_name_en": "Searchable", "mobile": "94" + s.zfill(8), "existing_member": True, "existing_membership_number": number})
    found = client.get(f"{API}/members/", headers=h, params={"search": number, "limit": 25}).json()
    assert any((m.get("membership_number") or m.get("member_code")) == number for m in found["data"])
