from test_frontend_contract import API, _sfx


def test_user_history_login_to_logout_and_member_timeline(client, admin_headers):
    s = _sfx()
    login = client.post(f"{API}/auth/login", data={"username": "admin", "password": "Admintest@123"}).json()
    h = {"Authorization": f"Bearer {login['access_token']}"}
    uid = client.get(f"{API}/auth/me", headers=h).json()["id"]

    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Timeline", "mobile": "96" + s.zfill(8)}).json()
    client.put(f"{API}/members/{m['id']}", headers=h, json={"first_name_en": "Timeline2", "occupation": "Teacher"})
    services = client.get(f"{API}/masters/service-types", headers=h).json()
    services = services["data"] if isinstance(services, dict) else services
    optin = client.post(f"{API}/members/{m['id']}/service-optins", headers=h, json={"service_type_id": services[0]["id"]})
    assert optin.status_code == 201, optin.text
    out = client.post(f"{API}/auth/logout", headers=h, json={"refresh_token": login["refresh_token"]})
    assert out.status_code == 200, out.text

    # ---- the user's own trail: sign-in ... what they did ... sign-out ----
    rows = client.get(f"{API}/activity/users", headers=admin_headers, params={"user_id": uid, "limit": 200}).json()["data"]
    ordered = sorted((r for r in rows if r.get("description")), key=lambda r: r["id"])
    trail = [r["description"] for r in ordered]
    sign_in = max(i for i, d in enumerate(trail) if d == "Logged in")
    sign_out = max(i for i, d in enumerate(trail) if d == "Logged out")
    assert sign_in < sign_out, trail
    between = trail[sign_in:sign_out]
    assert any(d.startswith("Created member Timeline") for d in between), trail
    assert any(
        d.startswith("Updated member Timeline2") and "First name: Timeline" in d and "Occupation: —" in d
        for d in between
    ), trail
    assert any(d.startswith("Created service") for d in between), trail
    assert {"AUTH", "DATA"} <= {r["activity_type"] for r in rows}

    # ---- the member's timeline: created (by whom, when), updated (what), service used ----
    tl = client.get(f"{API}/activity/members/{m['id']}/timeline", headers=admin_headers).json()
    events = list(reversed(tl["data"]))
    assert events[0]["action"] == "CREATE" and events[0]["description"].startswith("Created member")
    assert all(e["acted_by_name"] and e["created_at"] for e in events)
    updated = next(e for e in events if e["action"] == "UPDATE" and "first_name_en" in (e["details"].get("changes") or {}))
    assert updated["details"]["changes"]["occupation"] == {"from": None, "to": "Teacher"}
    assert any(
        e["details"].get("entity_type") == "member_service_optins" and e["description"].startswith("Created service")
        for e in events
    )
