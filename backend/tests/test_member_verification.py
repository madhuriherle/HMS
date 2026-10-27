"""Phone verification of members: outcome, call history, duplicates filter and export."""
import io


def _member(client, headers, mobile):
    r = client.post("/api/v1/members/", headers=headers, json={"first_name_en": "Verify", "last_name_en": "Me", "mobile": mobile})
    assert r.status_code == 201, r.text
    return r.json()


def test_verification_flow(client, admin_headers):
    a = _member(client, admin_headers, "9440000001")
    b = _member(client, admin_headers, "9440000001")
    assert a["verification_status"] == "NOT_VERIFIED"

    bad = client.put(f"/api/v1/members/{a['id']}/verification", headers=admin_headers, json={"status": "BOGUS"})
    assert bad.status_code == 422
    miss = client.put("/api/v1/members/99999999/verification", headers=admin_headers, json={"status": "VERIFIED"})
    assert miss.status_code == 404

    r = client.put(f"/api/v1/members/{a['id']}/verification", headers=admin_headers, json={"status": "call_back", "remark": "busy"})
    assert r.status_code == 200 and r.json()["status"] == "CALL_BACK"
    r = client.put(f"/api/v1/members/{a['id']}/verification", headers=admin_headers, json={"status": "VERIFIED", "remark": "all correct"})
    assert r.status_code == 200

    h = client.get(f"/api/v1/members/{a['id']}/verification", headers=admin_headers).json()
    assert h["status"] == "VERIFIED" and h["remark"] == "all correct"
    assert [c["status"] for c in h["calls"]] == ["VERIFIED", "CALL_BACK"]
    assert client.get(f"/api/v1/members/{a['id']}", headers=admin_headers).json()["verification_status"] == "VERIFIED"

    groups = client.get("/api/v1/members/duplicates", headers=admin_headers, params={"kind": "mobile", "search": "9440000001"}).json()["groups"]
    ms = {m["id"]: m["verification"] for m in groups[0]["members"]}
    assert ms[a["id"]] == "VERIFIED" and ms[b["id"]] == "NOT_VERIFIED"
    only = client.get("/api/v1/members/duplicates", headers=admin_headers,
                      params={"kind": "mobile", "search": "9440000001", "verification": "verified"}).json()
    assert only["total"] == 1

    x = client.get("/api/v1/members/duplicates", headers=admin_headers, params={"kind": "mobile", "search": "9440000001", "export": "excel"})
    assert x.status_code == 200
    from openpyxl import load_workbook
    rows = list(load_workbook(io.BytesIO(x.content)).active.values)
    assert "KYC" in rows[0] and any("Verified" in (r[rows[0].index("KYC")] or "") for r in rows[1:])
