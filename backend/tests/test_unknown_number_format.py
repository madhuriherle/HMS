"""The unknown receipt number may have no date in it and still restart every financial year."""


def test_unknown_number_restarts_yearly_without_a_date(client, admin_headers):
    api = "/api/v1"
    body = {"prefix": "NR", "date_part": "NONE", "separator": "-", "digits": 4, "start_value": 1, "restart": "FY", "suffix": "", "allow_manual": True}
    opts = client.get(f"{api}/system/number-formats", headers=admin_headers).json()["options"]
    assert "OLD_RECEIPT" in opts["yearly_plain_docs"]
    r = client.put(f"{api}/system/number-formats/OLD_RECEIPT", headers=admin_headers, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["example"].startswith("NR-0001")
    # a date part is still needed for the other documents that restart every year
    bad = client.put(f"{api}/system/number-formats/MEMBER_CODE", headers=admin_headers, json={**body, "prefix": "HMS"})
    assert bad.status_code == 400
    # each financial year starts again, whatever the date asked for
    a = client.get(f"{api}/receipts/old-number", headers=admin_headers, params={"date": "2031-05-10"}).json()
    b = client.get(f"{api}/receipts/old-number", headers=admin_headers, params={"date": "2032-05-10"}).json()
    assert a["next_number"] == "NR-0001" and b["next_number"] == "NR-0001"
    assert a["financial_year"] == "2031-32" and b["financial_year"] == "2032-33"
