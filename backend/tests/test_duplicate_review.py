"""Same person / different person answers on members that look alike."""


def _member(client, headers, first, last, mobile):
    r = client.post("/api/v1/members/", headers=headers, json={"first_name_en": first, "last_name_en": last, "mobile": mobile})
    assert r.status_code == 201, r.text
    return r.json()


def test_duplicate_review_flow(client, admin_headers):
    api = "/api/v1/members"
    a = _member(client, admin_headers, "Madhuri", "Hegdekar", "9450000001")
    b = _member(client, admin_headers, "Maduri", "Hegdekar", "9450000002")      # spelled a little differently
    c = _member(client, admin_headers, "Chandan", "Shettyy", "9450000001")      # same mobile, other person

    found = client.get(f"{api}/{a['id']}/possible-duplicates", headers=admin_headers).json()["items"]
    tags = {m["id"]: m["tags"] for m in found}
    assert tags[b["id"]] == ["Similar name"] and tags[c["id"]] == ["Same mobile"], tags
    assert all(m["review"] is None and "receipts_count" in m and "magazine" in m for m in found)

    bad = client.put(f"{api}/{a['id']}/duplicate-review", headers=admin_headers, json={"other_id": b["id"], "decision": "MAYBE"})
    assert bad.status_code == 400
    self_ = client.put(f"{api}/{a['id']}/duplicate-review", headers=admin_headers, json={"other_id": a["id"], "decision": "SAME"})
    assert self_.status_code == 400
    missing = client.put(f"{api}/{a['id']}/duplicate-review", headers=admin_headers, json={"other_id": 99999999, "decision": "SAME"})
    assert missing.status_code == 404

    # different people: the pair leaves the mobile report
    before = client.get(f"{api}/duplicates", headers=admin_headers, params={"kind": "mobile", "search": "9450000001"}).json()
    assert before["total"] == 1
    assert client.put(f"{api}/{a['id']}/duplicate-review", headers=admin_headers, json={"other_id": c["id"], "decision": "DIFFERENT"}).json()["decision"] == "DIFFERENT"
    after = client.get(f"{api}/duplicates", headers=admin_headers, params={"kind": "mobile", "search": "9450000001"}).json()
    assert after["total"] == 0
    # asked from the other side it is the same pair
    seen = {m["id"]: m["review"] for m in client.get(f"{api}/{c['id']}/possible-duplicates", headers=admin_headers).json()["items"]}
    assert seen[a["id"]] == "DIFFERENT"

    # the same person: the group waits for an admin
    assert client.put(f"{api}/{b['id']}/duplicate-review", headers=admin_headers, json={"other_id": a["id"], "decision": "SAME"}).status_code == 200
    similar = client.get(f"{api}/duplicates", headers=admin_headers, params={"kind": "similar", "search": "Hegdekar"}).json()["groups"]
    assert any("merge pending" in g["reason"] for g in similar)

    # taking an answer back
    assert client.put(f"{api}/{a['id']}/duplicate-review", headers=admin_headers, json={"other_id": c["id"], "decision": "CLEAR"}).json()["decision"] is None
    again = client.get(f"{api}/duplicates", headers=admin_headers, params={"kind": "mobile", "search": "9450000001"}).json()
    assert again["total"] == 1
