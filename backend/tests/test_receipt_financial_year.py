from test_frontend_contract import API
from test_receipt_entry_flow import _entry_payload


def _create(client, h, number, date):
    return client.post(f"{API}/receipts/", headers=h, json=_entry_payload(number, "FY Payer", receipt_date=date))


def test_financial_year_numbering_and_duplicate_messages(client, admin_headers):
    h = admin_headers
    # April starts a new year; March belongs to the previous one
    nxt = client.get(f"{API}/receipts/next-number", headers=h, params={"date": "2019-04-01"}).json()
    assert nxt["financial_year"] == "2019-20" and nxt["receipt_number"] == "2019-20/0001"
    assert client.get(f"{API}/receipts/next-number", headers=h, params={"date": "2020-03-31"}).json()["financial_year"] == "2019-20"

    # blank number -> server mints the next one for the year
    a = _create(client, h, None, "2019-06-10").json()
    b = _create(client, h, None, "2019-07-10").json()
    assert (a["receipt_number"], b["receipt_number"]) == ("2019-20/0001", "2019-20/0002")

    # a typed number moves the sequence on
    assert _create(client, h, "2019-20/0050", "2019-08-01").status_code == 201
    assert client.get(f"{API}/receipts/next-number", headers=h, params={"date": "2019-09-01"}).json()["receipt_number"] == "2019-20/0051"

    # same number, same year -> clear message
    dup = _create(client, h, "2019-20/0001", "2019-12-01")
    assert dup.status_code == 409
    assert "2019-20/0001" in dup.json()["detail"] and "financial year 2019-20" in dup.json()["detail"]

    # same text in another financial year is a different receipt
    assert _create(client, h, "2019-20/0001", "2020-04-05").status_code == 201

    # editing the date into a year where the number already exists is refused with the same message
    c = _create(client, h, "X-7", "2021-05-05").json()
    assert _create(client, h, "X-7", "2022-05-05").status_code == 201
    r = client.put(f"{API}/receipts/{c['id']}", headers=h, json={"receipt_date": "2022-06-01"})
    assert r.status_code == 409 and "financial year 2022-23" in r.json()["detail"]
    # renumbering to a free number works; to a taken one does not
    assert client.put(f"{API}/receipts/{c['id']}", headers=h, json={"receipt_number": "X-8"}).status_code == 200
    r = client.put(f"{API}/receipts/{c['id']}", headers=h, json={"receipt_number": "2019-20/0001", "receipt_date": "2019-05-01"})
    assert r.status_code == 409


def test_default_date_is_last_entered_receipt(client, admin_headers):
    h = admin_headers
    _create(client, h, None, "2018-02-14")
    assert client.get(f"{API}/receipts/next-number", headers=h).json()["default_date"] == "2018-02-14"


def test_one_receipt_many_particular_lines(client, admin_headers):
    h = admin_headers
    pid = client.post(f"{API}/masters/particulars", headers=h, json={"name_en": "Hostel deposit", "code": "HD1"}).json()["id"]
    lines = [
        {"item_type": "OTHER", "particular_id": pid, "particular_name": "Hostel deposit", "amount": 3000},
        {"item_type": "DONATION", "particular_name": "Building donation", "amount": 2000},
        {"item_type": "OTHER", "particular_name": "Others", "description": "Mess deposit", "amount": 2000},
        {"item_type": "OTHER", "particular_name": "Application fee", "amount": 230},
    ]
    body = _entry_payload(None, "Multi Payer", receipt_date="2019-10-09", receipt_type="OTHER",
                          gross_amount=7230, net_amount=7230, items=lines)
    wrong = client.post(f"{API}/receipts/", headers=h, json={**body, "gross_amount": 7000, "net_amount": 7000})
    assert wrong.status_code == 400 and "add up to 7230.00" in wrong.json()["detail"]
    bad_p = client.post(f"{API}/receipts/", headers=h, json={**body, "items": [{**lines[0], "particular_id": 99999}] + lines[1:]})
    assert bad_p.status_code == 400

    ok = client.post(f"{API}/receipts/", headers=h, json=body)
    assert ok.status_code == 201, ok.text
    row = next(x for x in client.get(f"{API}/receipts/tracking", headers=h, params={"limit": 500}).json()["data"]
               if x["id"] == ok.json()["id"])
    assert row["items_count"] == 4 and [i["amount"] for i in row["items"]] == [3000, 2000, 2000, 230]
    assert row["items"][2]["description"] == "Mess deposit"

    # replace the lines on edit; the receipt total follows
    r = client.put(f"{API}/receipts/{ok.json()['id']}", headers=h, json={"items": lines[:2]})
    assert r.status_code == 200 and float(r.json()["net_amount"]) == 5000
    row = next(x for x in client.get(f"{API}/receipts/tracking", headers=h, params={"limit": 500}).json()["data"]
               if x["id"] == ok.json()["id"])
    assert row["items_count"] == 2


def test_pdf_day_book_and_duplicate_check(client, admin_headers):
    h = admin_headers
    r = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(None, "Pdf Payer", receipt_date="2018-05-05", net_amount=730, gross_amount=730,
                                                                    items=[{"item_type": "OTHER", "particular_name": "Hostel deposit", "amount": 500},
                                                                           {"item_type": "DONATION", "particular_name": "Building donation", "amount": 230}]))
    assert r.status_code == 201, r.text
    pdf = client.get(f"{API}/receipts/{r.json()['id']}/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:5] == b"%PDF-"

    book = client.get(f"{API}/receipts/day-book", headers=h, params={"from_date": "2018-05-05"}).json()
    assert book["total"] == 730 and book["receipt_count"] == 1
    assert {p["particular"]: p["amount"] for p in book["by_particular"]} == {"Hostel deposit": 500, "Building donation": 230}

    dup = client.get(f"{API}/receipts/duplicate-check", headers=h, params={"payer_name": " pdf payer ", "net_amount": 730, "date": "2018-05-05"}).json()
    assert len(dup["matches"]) == 1
    none = client.get(f"{API}/receipts/duplicate-check", headers=h, params={"payer_name": "Pdf Payer", "net_amount": 731, "date": "2018-05-05"}).json()
    assert none["matches"] == []

    from services.receipt_pdf import amount_in_words, build_receipt_pdf
    assert amount_in_words(8230) == "Eight Thousand Two Hundred and Thirty Rupees Only"
    assert amount_in_words(100000) == "One Lakh Rupees Only"

    # Test PDF generation directly with sparse / cancelled receipt
    class DummyReceipt:
        id = 99
        receipt_number = "2026-27/0099"
        receipt_date = None
        payer_name = None
        receipt_status = "CANCELLED"
        payment_status = "CANCELLED"
        net_amount = 0
        payment_mode = None
        bank_account = None
        transaction_reference = None
        period_from_date = None
        period_to_date = None
        period_from_time = None
        period_to_time = None

    pdf_sparse = build_receipt_pdf(DummyReceipt(), [], None, [])
    assert pdf_sparse[:5] == b"%PDF-"
