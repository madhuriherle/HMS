"""Settings > Number Formats: member ID, membership number and receipt number."""

import re

from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload

DEFAULT_RECEIPT = dict(prefix="", date_part="FY", separator="/", digits=4, start_value=1, restart="FY", suffix="", allow_manual=True)


def _put(client, h, doc, **body):
    return client.put(f"{API}/system/number-formats/{doc}", headers=h, json=body)


def test_defaults_match_the_old_formats(client, admin_headers):
    rows = {r["doc_type"]: r for r in client.get(f"{API}/system/number-formats", headers=admin_headers).json()["data"]}
    assert re.fullmatch(r"HMS-\d{8}-000001", rows["MEMBER_CODE"]["example"])
    assert "MEMBERSHIP_NO" not in rows  # one permanent number: the membership number
    assert re.fullmatch(r"\d{4}-\d\d/0001", rows["RECEIPT"]["example"])


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
        first = client.post(f"{API}/receipts/", headers=h, json=_entry_payload("MAN-0040", "Typed"))
        assert first.status_code == 201, first.text
        nxt = client.get(f"{API}/receipts/next-number", headers=h).json()["receipt_number"]
        assert nxt == "MAN-0041"
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
