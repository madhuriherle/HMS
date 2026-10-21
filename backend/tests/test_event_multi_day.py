"""Events can run over several days: optional end_date, never before the first day."""

from test_frontend_contract import API, _items, _sfx


def test_multi_day_event(client, admin_headers):
    h, s = admin_headers, _sfx()
    r = client.post(f"{API}/events/", headers=h, json={"title": "Sammelana " + s, "event_date": "2099-12-01", "end_date": "2099-12-03"})
    assert r.status_code in (200, 201), r.text
    ev = r.json()
    assert ev["end_date"] == "2099-12-03"
    assert client.get(f"{API}/events/{ev['id']}/detail", headers=h).json()["event"]["end_date"] == "2099-12-03"

    bad = client.post(f"{API}/events/", headers=h, json={"title": "Bad " + s, "event_date": "2099-12-05", "end_date": "2099-12-04"})
    assert bad.status_code == 422

    # a one-day event keeps working without an end date
    one = client.post(f"{API}/events/", headers=h, json={"title": "One " + s, "event_date": "2099-12-09"})
    assert one.status_code in (200, 201) and one.json()["end_date"] is None
