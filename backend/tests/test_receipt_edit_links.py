"""Editing a receipt's number, date, amount and lines keeps every link in step: the member link, the allocation, the financial year,
the member's payment table and Receipt Tracking."""
from test_frontend_contract import API, _items, _sfx
from test_member_lookup import _approved_member
from test_receipt_entry_flow import _entry_payload


def test_editing_a_receipt_updates_everything_linked_to_it(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid, _type, _code = _approved_member(client, h, s)
    body = _entry_payload(f"L-{s}", "Link Payer", receipt_date="2026-05-10", allocations=[{"member_id": mid, "allocated_amount": 500}],
                          gross_amount=500, net_amount=500, items=[{"item_type": "MEMBERSHIP", "description": "Membership", "amount": 500}])
    rec = client.post(f"{API}/receipts/", headers=h, json=body)
    assert rec.status_code in (200, 201), rec.text
    rid = rec.json()["id"]

    def payments():
        return client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["payments"]["rows"]

    assert [(r["receipt_number"], r["financial_year"], r["paid"]) for r in payments()] == [(f"L-{s}", "2026-27", 500)]

    edit = _entry_payload("x", "Link Payer", receipt_date="2025-12-01", gross_amount=750, net_amount=750,
                          items=[{"item_type": "MEMBERSHIP", "description": "Membership", "amount": 750}])
    edit.pop("allocations")
    edit["receipt_number"] = f"M-{s}"
    up = client.put(f"{API}/receipts/{rid}", headers=h, json=edit)
    assert up.status_code == 200, up.text

    rows = payments()                                              # the member's payment table follows
    assert [(r["receipt_number"], r["receipt_date"], r["financial_year"], r["paid"]) for r in rows] == [(f"M-{s}", "2025-12-01", "2025-26", 750)]
    allocs = client.get(f"{API}/receipts/{rid}/allocations", headers=h).json()
    assert len(allocs) == 1 and float(allocs[0]["allocated_amount"]) == 750 and allocs[0]["member_id"] == mid
    row = next(x for x in _items(client.get(f"{API}/receipts/tracking", headers=h, params={"limit": 500, "member_ids": mid}).json()) if x["id"] == rid)
    assert row["receipt_number"] == f"M-{s}" and row["amount"] == 750 and row["member_id"] == mid
