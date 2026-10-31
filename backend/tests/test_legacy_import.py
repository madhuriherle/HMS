"""Dry run of the old register: the rules on a tiny workbook, and the screen's start / status / report calls."""
import io
import time
from datetime import date, datetime

from test_frontend_contract import API


def _register(rows):
    from openpyxl import Workbook
    cols = ["CusNo", "CusNoNew", "CusNoOld", "CusTitle", "CusName", "CusMobile", "CusMemberType", "CusGotra", "CusStatus", "DeleteMark",
            "CusRelation", "CusNameFather",
            "CusPost", "CusPinCode", "CusState", "CusDistrict", "CusTaluk", "CusNameKannada", "CusMemUpAmt1",
            "CusMagazine", "CusOnline", "CusEmail", "CusNote", "CusNoteMagazine", "CusStatusNote"]
    for j in range(1, 7):
        cols += [f"CusReceiptNo{j}", f"CusReceiptDate{j}", f"CusMemAmt{j}", f"CusMemUpAmt{j}", f"CusScholarAmt{j}", f"CusDon1Amt{j}", f"CusReceiptNote{j}"]
    wb = Workbook()
    ws = wb.active
    ws.append(cols)
    for r in rows:
        ws.append([r.get(c) for c in cols])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _row(no, name, rec=(), **kw):
    r = {"CusNo": no, "CusNoNew": 0, "CusNoOld": 0, "CusName": name, "CusMemberType": "AJEEVA", "CusStatus": "Normal"}
    r.update(kw)
    for j, (num, d, amt) in enumerate(rec, 1):
        r[f"CusReceiptNo{j}"], r[f"CusReceiptDate{j}"], r[f"CusMemAmt{j}"] = num, d, amt
    return r


def test_register_rules(client):
    from db.session import SessionLocal
    from services import legacy_import

    rows = legacy_import.read_register(_register([
        _row(1, "ASHA RAO", [(100, datetime(1980, 5, 1), 200)], CusMobile="9876543210"),
        _row(2, "ASHA RAO", [(None, datetime(1980, 6, 1), 0)], CusMobile="9876543210"),            # date only -> dummy, amount 0
        _row(3, "BHARATH", [(100, datetime(1980, 5, 1), 100)]),                                        # same number + date as Asha: still a receipt of his own (100/2)
        _row(4, "CHARAN", [(100, datetime(1980, 9, 9), 100)]),                                         # same number, a later date: 100/2 (the register number with a tail)
        _row(5, "DEEPA", [(7, datetime(1927, 1, 1), 100), (8, datetime(2301, 1, 1), 100), (9, None, 100)]),   # wrong dates, no date
        _row(6, "ESHA", [(11, datetime(2001, 4, 1), 0)], CusMemberType="POSHAK", DeleteMark="*"),     # zero amount, typo type
    ]))
    db = SessionLocal()
    try:
        plan = legacy_import.build_plan(db, rows, today=date(2026, 10, 26))
    finally:
        db.close()
    c = plan["counts"]
    assert c["members"] == 6 and c["deleted"] == 1
    assert sorted(d["dummy"] for d in plan["dummies"]) == ["FY80-0001"]
    assert {d["cus_no"] for d in plan["dummies"]} == {2}
    line = lambda no: next(ln for m in plan["members"] if m["cus_no"] == no for ln in m["lines"])
    # every record is a receipt of its own: the earliest keeps 100, then by date and membership number 100/2 (Bharath, same date), 100/3 (Charan)
    assert line(1)["number"] == "100" and line(3)["number"] == "100/2" and line(4)["number"] == "100/3"
    assert c["receipts_shared_by_members"] == 1 and plan["shared"][0]["members"] == [1, 3]
    assert c["receipts_wrong_date"] == 2 and c["receipts_no_date"] == 1
    assert c["receipts_zero_amount"] == 1
    assert c["duplicate_mobile_members"] == 0 or plan["dup_mobile"][0]["same_name_in_group"] == "YES"
    assert any("POSHAK" in p["problem"] for p in plan["problems"])
    assert len(legacy_import.reports_xlsx(plan)) > 1000


def test_dry_run_endpoints(client, admin_headers):
    started = client.post(f"{API}/members/legacy-import/dry-run", headers=admin_headers,
                          files={"file": ("MstMember.xlsx", _register([_row(1, "ASHA RAO", [(5, datetime(2001, 4, 1), 100)])]))})
    assert started.status_code == 200, started.text
    job = started.json()["job_id"]
    for _ in range(50):
        info = client.get(f"{API}/members/legacy-import/dry-run/{job}", headers=admin_headers).json()
        if info["status"] != "RUNNING":
            break
        time.sleep(0.2)
    assert info["status"] == "DONE", info
    assert info["counts"]["members"] == 1
    report = client.get(f"{API}/members/legacy-import/dry-run/{job}/report", headers=admin_headers)
    assert report.status_code == 200 and report.content[:2] == b"PK"
    assert client.get(f"{API}/members/legacy-import/dry-run/{'0' * 32}", headers=admin_headers).status_code == 404
    assert client.get(f"{API}/members/legacy-import/dry-run/not-a-job", headers=admin_headers).status_code == 404


def test_name_titles_master(client, admin_headers):
    """Titles are a master: listed, added, in the rules the Register form reads, and blocked from delete while used."""
    h = admin_headers
    listed = client.get(f"{API}/masters/name-titles", headers=h)
    assert listed.status_code == 200, listed.text
    made = client.post(f"{API}/masters/name-titles", headers=h, json={"name_en": "TESTTITLE."})
    assert made.status_code == 201, made.text
    assert client.post(f"{API}/masters/name-titles", headers=h, json={"name_en": "TESTTITLE."}).status_code == 409
    assert "TESTTITLE." in client.get(f"{API}/meta/rules", headers=h).json()["name_titles"]
    off = client.put(f"{API}/masters/name-titles/{made.json()['id']}", headers=h, json={"status": False})
    assert off.status_code == 200
    assert "TESTTITLE." not in client.get(f"{API}/meta/rules", headers=h).json()["name_titles"]
    assert client.delete(f"{API}/masters/name-titles/{made.json()['id']}", headers=h).status_code in (200, 204)
