"""Receipt Tracking: the receipt number order, the address on a receipt and the full export."""
import io

from test_frontend_contract import API, _sfx


def _post(client, h, number, date, **over):
    body = {"receipt_date": date, "receipt_type": "DONATION", "payment_mode": "CASH", "gross_amount": 10, "net_amount": 10,
            "source": "OFFLINE", "receipt_number": number, "payer_name": "Sort " + number,
            "items": [{"item_type": "DONATION", "particular_name": "Seva", "amount": 10}]}
    body.update(over)
    r = client.post(f"{API}/receipts/", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_numbers_sort_as_numbers_year_first_and_the_address_is_kept(client, admin_headers):
    h, s = admin_headers, _sfx()
    # three receipts of one financial year, entered in a mixed order: 0031, 998, 1058 (number order is 1058, 998, 0031)
    pre = "ZZ"
    a = _post(client, h, "0031", "2024-05-02", payer_name=pre + "a", payer_address="12 Temple Road, Sirsi")
    _post(client, h, "1058", "2024-05-01", payer_name=pre + "b")
    _post(client, h, "998", "2024-05-03", payer_name=pre + "c")
    _post(client, h, "0007", "2025-05-01", payer_name=pre + "d")     # the next financial year: on top
    got = client.get(f"{API}/receipts/tracking", headers=h, params={"search": pre, "limit": 20}).json()["data"]
    order = [r["receipt_number"] for r in got if r["payer_name"].startswith(pre)]
    assert order == ["0007", "1058", "998", "0031"], order
    # the column heading still sorts, as numbers
    asc = client.get(f"{API}/receipts/tracking", headers=h, params={"search": pre, "limit": 20, "sort_by": "receipt_number", "sort_dir": "asc"}).json()["data"]
    assert [r["receipt_number"] for r in asc if r["payer_name"].startswith(pre)] == ["0031", "998", "1058", "0007"]
    assert client.get(f"{API}/receipts/tracking", headers=h, params={"sort_dir": "sideways"}).status_code == 400
    # the address is stored, shown in the rows and can be edited
    row = next(r for r in got if r["receipt_number"] == "0031")
    assert row["payer_address"] == "12 Temple Road, Sirsi"
    assert client.put(f"{API}/receipts/{a['id']}", headers=h, json={"payer_address": "New Address 5"}).status_code == 200
    assert client.get(f"{API}/receipts/{a['id']}", headers=h).json()["payer_address"] == "New Address 5"

    # the month filter: May of every year
    only = client.get(f"{API}/receipts/tracking", headers=h, params={"search": pre, "month": 5, "fy": "2024-25", "limit": 20}).json()["data"]
    assert sorted(r["receipt_number"] for r in only) == ["0031", "1058", "998"]

    # the export carries every field
    x = client.get(f"{API}/receipts/tracking", headers=h, params={"search": pre, "export": "excel"})
    assert x.status_code == 200
    from openpyxl import load_workbook
    rows = list(load_workbook(io.BytesIO(x.content)).active.values)
    head = list(rows[0])
    for col in ("Receipt No", "Date", "Financial Year", "Particular Lines", "Payer Name", "Payer Mobile", "Address", "PAN", "Payment Mode", "Bank Account",
                "Transaction Id", "Cheque No", "Period From Date", "Notes", "Receipt Status", "Unknown Receipt", "Entered By", "Entered On"):
        assert col in head, col
    line = next(r for r in rows[1:] if r[head.index("Receipt No")] == "0031")
    assert line[head.index("Address")] == "New Address 5" and "Seva: 10" in line[head.index("Particular Lines")]
