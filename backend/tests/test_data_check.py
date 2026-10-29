"""The Data Check lists: members whose stored data looks wrong, one list per problem."""
import time
from datetime import date

from test_api import _create_member


def _make(client, admin_headers, tag, dob=None, alt=None):
    from db.session import SessionLocal
    from models.members import Member

    m = _create_member(client, admin_headers, "93" + str(int(time.time() * 1000))[-8:], tag)
    db = SessionLocal()
    try:
        row = db.get(Member, m["id"])
        row.date_of_birth, row.alternate_mobile = dob, alt
        db.commit()
    finally:
        db.close()
    return m["id"]


def test_data_check_lists_each_problem(client, admin_headers):
    today = date.today()
    tag = "DC" + str(int(time.time()))[-6:]
    future = _make(client, admin_headers, tag + "Future", dob=today.replace(year=today.year + 3))
    child = _make(client, admin_headers, tag + "Child", dob=today.replace(year=today.year - 9))
    adult = _make(client, admin_headers, tag + "Adult", dob=today.replace(year=today.year - 40))
    ancient = _make(client, admin_headers, tag + "Ancient", dob=date(1850, 1, 1))
    landline = _make(client, admin_headers, tag + "Landline", dob=today.replace(year=today.year - 30), alt="080-23580117")
    fine_alt = _make(client, admin_headers, tag + "FineAlt", dob=today.replace(year=today.year - 30), alt="9876543210")

    def ids(kind, **extra):
        r = client.get("/api/v1/data-check/members", headers=admin_headers, params={"kind": kind, "search": tag, "limit": 50, **extra})
        assert r.status_code == 200, r.text
        return {x["id"] for x in r.json()["rows"]}, r.json()

    assert ids("future_dob")[0] == {future}
    assert ids("under_18")[0] == {child}
    assert ids("very_old")[0] == {ancient}
    assert ids("alt_number")[0] == {landline}
    assert adult not in ids("under_18")[0] | ids("future_dob")[0] and fine_alt not in ids("alt_number")[0]
    row = ids("under_18")[1]["rows"][0]
    assert row["age"] == 9 and row["name"].startswith(tag)
    assert client.get("/api/v1/data-check/members", headers=admin_headers, params={"kind": "nope"}).status_code == 400
    x = client.get("/api/v1/data-check/members", headers=admin_headers, params={"kind": "under_18", "search": tag, "export": "excel"})
    assert x.status_code == 200 and x.content[:2] == b"PK"
