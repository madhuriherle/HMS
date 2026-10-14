"""Settings > Number Formats: member ID, membership number and receipt number."""

import re

from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload

DEFAULT_RECEIPT = dict(prefix="", date_part="NONE", separator="", digits=4, start_value=1, restart="FY", suffix="", allow_manual=True)


def _put(client, h, doc, **body):
    return client.put(f"{API}/system/number-formats/{doc}", headers=h, json=body)


def test_defaults_match_the_old_formats(client, admin_headers):
    rows = {r["doc_type"]: r for r in client.get(f"{API}/system/number-formats", headers=admin_headers).json()["data"]}
    assert re.fullmatch(r"HMS-\d{8}-000001", rows["MEMBER_CODE"]["example"])
    assert "MEMBERSHIP_NO" not in rows  # one permanent number: the membership number
    assert rows["RECEIPT"]["example"] == "0001"


def test_a_format_that_could_repeat_numbers_is_refused(client, admin_headers):
    bad = _put(client, admin_headers, "RECEIPT", **{**DEFAULT_RECEIPT, "restart": "DAY", "date_part": "NONE"})
    assert bad.status_code == 400 and "repeat" in bad.json()["detail"]
    assert _put(client, admin_headers, "RECEIPT", **{**DEFAULT_RECEIPT, "digits": 2}).status_code == 400
    assert _put(client, admin_headers, "RECEIPT", **{**DEFAULT_RECEIPT, "prefix": "a b!"}).status_code == 400
    assert _put(client, admin_headers, "NOPE", **DEFAULT_RECEIPT).status_code == 404


def test_receipt_numbers_follow_the_saved_format_and_manual_switch(client, admin_headers):
    h, s = admin_headers, _sfx()
    try:
        ok = _put(client, h, "RECEIPT", prefix="REC", date_part="FY_SHORT", separator="/", digits=5,
                  start_value=900, restart="FY", suffix="", allow_manual=False)
        assert ok.status_code == 200, ok.text
        shown = client.get(f"{API}/receipts/next-number", headers=h).json()
        assert re.fullmatch(r"REC/\d\d-\d\d/00900", shown["receipt_number"]) and shown["allow_manual"] is False

        a = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("IGNORED-" + s, "Fmt A"))
        assert a.status_code == 201, a.text
        assert re.fullmatch(r"REC/\d\d-\d\d/00900", a.json()["receipt_number"])  # typed number ignored
        b = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("", "Fmt B"))
        assert re.fullmatch(r"REC/\d\d-\d\d/00901", b.json()["receipt_number"])
    finally:
        assert _put(client, h, "RECEIPT", **DEFAULT_RECEIPT).status_code == 200


def test_typed_number_in_the_format_moves_the_counter_past_it(client, admin_headers):
    h = admin_headers
    try:
        assert _put(client, h, "RECEIPT", prefix="MAN", date_part="NONE", separator="-", digits=4,
                    start_value=1, restart="NEVER", suffix="", allow_manual=True).status_code == 200
        first = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("MAN-0900", "Typed"))
        assert first.status_code == 201, first.text
        nxt = client.get(f"{API}/receipts/next-number", headers=h).json()["receipt_number"]
        assert nxt == "MAN-0901"
    finally:
        assert _put(client, h, "RECEIPT", **DEFAULT_RECEIPT).status_code == 200


def test_member_code_uses_the_saved_format(client, admin_headers):
    from db.session import SessionLocal
    from services import numbering

    h = admin_headers
    try:
        assert _put(client, h, "MEMBER_CODE", prefix="MBR", date_part="YEAR", separator="/", digits=4,
                    start_value=100, restart="YEAR", suffix="", allow_manual=True).status_code == 200
        db = SessionLocal()
        try:
            code = numbering.next_number(db, "MEMBER_CODE", commit=True)
        finally:
            db.close()
        assert re.fullmatch(r"MBR/\d{4}/\d{4}", code) and int(code[-4:]) >= 100
    finally:
        assert _put(client, h, "MEMBER_CODE", prefix="HMS", date_part="DATE_FULL", separator="-", digits=6,
                    start_value=1, restart="NEVER", suffix="", allow_manual=True).status_code == 200


def test_preview_is_a_get_and_rejects_a_repeating_format(client, admin_headers):
    ok = client.get(f"{API}/system/number-formats/RECEIPT/preview", headers=admin_headers,
                    params={"prefix": "ABC", "date_part": "FY", "separator": "/", "digits": 4, "restart": "FY"})
    assert ok.status_code == 200 and ok.json()["example"].startswith("ABC/20")
    bad = client.get(f"{API}/system/number-formats/RECEIPT/preview", headers=admin_headers,
                     params={"date_part": "NONE", "restart": "DAY"})
    assert bad.status_code == 400


def test_receipt_numbers_can_restart_every_year_with_no_year_in_the_number(client, admin_headers):
    import random

    h = admin_headers
    y = random.randint(1700, 1990)  # a year no other test uses, so the run can be repeated on the same database
    r = _put(client, h, "RECEIPT", prefix="", date_part="NONE", separator="", digits=4, start_value=1,
             restart="FY", suffix="", allow_manual=True)
    assert r.status_code == 200, r.text
    first = client.get(f"{API}/receipts/next-number", headers=h, params={"date": f"{y}-04-01"}).json()
    assert first["receipt_number"] == "0001" and first["financial_year"] == f"{y}-{str(y + 1)[-2:]}"
    made = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(None, "Yearly", receipt_date=f"{y}-05-01"))
    assert made.status_code == 201, made.text
    assert made.json()["receipt_number"] == "0001"
    nxt = client.get(f"{API}/receipts/next-number", headers=h, params={"date": f"{y}-06-01"}).json()
    assert nxt["receipt_number"] == "0002"
    # the next financial year starts again from 0001
    again = client.get(f"{API}/receipts/next-number", headers=h, params={"date": f"{y + 1}-04-01"}).json()
    assert again["receipt_number"] == "0001" and again["financial_year"] == f"{y + 1}-{str(y + 2)[-2:]}"
    # a restart by calendar year with no year in the number could repeat inside one financial year: refused
    assert _put(client, h, "RECEIPT", **{**DEFAULT_RECEIPT, "restart": "YEAR"}).status_code == 400


def test_a_receipt_number_is_unique_within_each_financial_year(client, admin_headers):
    """0010 can be used once per financial year: a second 0010 in the same year is refused, in another year it is fine."""
    import random

    h = admin_headers
    y = random.randint(1700, 1990)
    assert _put(client, h, "RECEIPT", **DEFAULT_RECEIPT).status_code == 200
    first = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("0010", "First", receipt_date=f"{y}-06-01"))
    assert first.status_code == 201, first.text
    # same number, same financial year (a different date inside it, and with stray spaces) -> refused
    for number, date in (("0010", f"{y}-09-15"), (" 0010 ", f"{y + 1}-02-01")):
        dup = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(number, "Second", receipt_date=date))
        assert dup.status_code == 409, (number, date, dup.text)
        assert "0010" in dup.json()["detail"] and f"{y}-{str(y + 1)[-2:]}" in dup.json()["detail"]
    # the same number in the next financial year is a different receipt
    other = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("0010", "Third", receipt_date=f"{y + 1}-04-02"))
    assert other.status_code == 201, other.text
    # moving a receipt's date into a year that already has its number is refused too
    moved = client.put(f"{API}/receipts/{other.json()['id']}", headers=h, json={"receipt_date": f"{y}-07-01"})
    assert moved.status_code == 409, moved.text


def test_number_check_says_whether_a_number_is_free_in_the_year(client, admin_headers):
    import random

    h = admin_headers
    y = random.randint(1700, 1990)
    assert _put(client, h, "RECEIPT", **DEFAULT_RECEIPT).status_code == 200
    check = lambda number, date, **extra: client.get(  # noqa: E731
        f"{API}/receipts/number-check", headers=h, params={"number": number, "date": date, **extra}).json()
    assert check("0010", f"{y}-06-01")["available"] is True
    made = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("0010", "Checked", receipt_date=f"{y}-06-01")).json()
    taken = check(" 0010 ", f"{y}-12-01")  # another date in the same financial year, with stray spaces
    assert taken["available"] is False and taken["existing"]["payer_name"] == "Checked"
    assert f"{y}-{str(y + 1)[-2:]}" in taken["message"] and taken["matches_format"] is True
    assert check("0010", f"{y + 1}-04-01")["available"] is True  # the next financial year is free
    assert check("0010", f"{y}-06-01", exclude_id=made["id"])["available"] is True  # editing that very receipt
    assert check("A-1", f"{y}-06-01")["matches_format"] is False
    assert check("", f"{y}-06-01")["available"] is True
    assert client.get(f"{API}/receipts/number-check", params={"number": "1", "date": f"{y}-06-01"}).status_code == 401


def test_a_deleted_receipt_keeps_its_number_until_it_is_purged(client, admin_headers):
    import random

    h = admin_headers
    y = random.randint(1700, 1990)
    assert _put(client, h, "RECEIPT", **DEFAULT_RECEIPT).status_code == 200
    day = lambda m: f"{y}-{m:02d}-01"  # noqa: E731
    nxt = lambda: client.get(f"{API}/receipts/next-number", headers=h, params={"date": day(6)}).json()["receipt_number"]  # noqa: E731
    check = lambda n: client.get(f"{API}/receipts/number-check", headers=h, params={"number": n, "date": day(6)}).json()  # noqa: E731
    assert nxt() == "0001"
    first = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(None, "One", receipt_date=day(6))).json()
    second = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(None, "Two", receipt_date=day(7))).json()
    assert (first["receipt_number"], second["receipt_number"]) == ("0001", "0002") and nxt() == "0003"

    # a soft delete (the Delete button) keeps the number: it is in the Recycle Bin and can come back
    assert client.delete(f"{API}/receipts/{second['id']}", headers=h).status_code == 200
    assert nxt() == "0003", "the number of a receipt in the Recycle Bin is not offered again"
    taken = check("0002")
    assert taken["available"] is False and taken["existing"]["in_recycle_bin"] is True and "Recycle Bin" in taken["message"]
    typed = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("0002", "Typed", receipt_date=day(8)))
    assert typed.status_code == 409 and "Recycle Bin" in typed.json()["detail"]
    item = {"entity": "receipt", "id": second["id"]}
    assert client.post(f"{API}/system/recycle-bin/restore", headers=h, json={"items": [item]}).json()["restored"] == 1

    # a permanent delete gives the number back
    assert client.delete(f"{API}/receipts/{second['id']}", headers=h).status_code == 200
    assert client.post(f"{API}/system/recycle-bin/purge", headers=h, json={"items": [item]}).json()["deleted"] == 1
    assert nxt() == "0002" and check("0002")["available"] is True

    # a cancelled receipt keeps its number (it still exists in the register)
    assert client.post(f"{API}/receipts/{first['id']}/cancel", headers=h, json={"reason": "test"}).status_code == 200
    assert nxt() == "0002"
