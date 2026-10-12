"""Receipt Entry's PAN / mobile / membership no. are stored as data, and an edit keeps bank account + transaction date."""

from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload


def test_payer_details_are_stored_even_when_mapped_to_a_member(client, admin_headers):
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Payer", "mobile": "96" + s.zfill(8)}).json()
    body = _entry_payload(f"PD-{s}", "Payer One", payer_pan="ABCDE1234F", payer_mobile="9876543210",
                          payer_membership_no="HMSM-1", allocations=[{"member_id": m["id"], "allocated_amount": 1000}])
    r = client.post(f"{API}/receipts/", headers=h, json=body)
    assert r.status_code == 201, r.text
    got = client.get(f"{API}/receipts/{r.json()['id']}", headers=h).json()
    assert (got["payer_pan"], got["payer_mobile"], got["payer_membership_no"]) == ("ABCDE1234F", "9876543210", "HMSM-1")
    assert "PAN" not in (got.get("notes") or "")


def test_receipt_edit_keeps_bank_account_transaction_date_and_payer_details(client, admin_headers):
    h, s = admin_headers, _sfx()
    r = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"ED-{s}", "Edit Me"))
    rid = r.json()["id"]
    upd = client.put(f"{API}/receipts/{rid}", headers=h, json={
        "bank_account": "SBI Main", "transaction_date": "2026-10-05", "payer_pan": "ABCDE1234F", "payer_mobile": "9123456780",
    })
    assert upd.status_code == 200, upd.text
    got = client.get(f"{API}/receipts/{rid}", headers=h).json()
    assert got["bank_account"] == "SBI Main" and got["transaction_date"] == "2026-10-05"
    assert got["payer_pan"] == "ABCDE1234F" and got["payer_mobile"] == "9123456780"
